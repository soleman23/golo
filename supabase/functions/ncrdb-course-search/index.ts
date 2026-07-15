import { corsHeaders, jsonResponse } from '../_shared/http.ts'

const NCRDB_BASE = 'https://ncrdb.usga.org'
const NCRDB_TIMEOUT_MS = 10_000
const TEE_TABLE_STRUCTURE_ERROR = 'NCRDB tee table not found — page structure may have changed'

type NcrdbSession = {
  token: string
  cookie: string
}

let cachedSession: NcrdbSession | null = null

/**
 * The NCRDB has no public API — its search endpoint is an ASP.NET Razor
 * AJAX handler guarded by an antiforgery token + cookie, so every search
 * starts with an antiforgery session scraped from the landing page.
 */
async function getNcrdbSession(forceFresh = false): Promise<NcrdbSession> {
  if (!forceFresh && cachedSession) return cachedSession

  const res = await fetch(`${NCRDB_BASE}/`, { signal: AbortSignal.timeout(NCRDB_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`NCRDB session fetch failed: ${res.status}`)
  const html = await res.text()

  const tokenMatch =
    html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i) ??
    html.match(/value="([^"]+)"[^>]*name="__RequestVerificationToken"/i)
  if (!tokenMatch) throw new Error('NCRDB CSRF token not found')

  const setCookies: string[] = res.headers.getSetCookie()
  const cookie = setCookies.map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ')
  if (!cookie) throw new Error('NCRDB antiforgery cookie not found')

  cachedSession = { token: tokenMatch[1], cookie }
  return cachedSession
}

type SearchParams = {
  clubName?: string
  clubCity?: string
  clubState?: string
  clubCountry?: string
}

type ParsedTable = {
  rows: string[][]
}

type Scorecard = {
  teeName?: string
  gender?: string
  pars: Record<number, number>
  strokeIndex?: Record<number, number>
}

const capInput = (value: unknown) => String(value ?? '').trim().slice(0, 100)

function searchBody(params: SearchParams) {
  return new URLSearchParams({
    clubName: capInput(params.clubName),
    clubCity: capInput(params.clubCity),
    clubState: capInput(params.clubState),
    clubCountry: capInput(params.clubCountry) || 'USA',
  })
}

function postSearch(session: NcrdbSession, body: URLSearchParams) {
  return fetch(`${NCRDB_BASE}/NCRListing?handler=LoadCourses`, {
    method: 'POST',
    headers: {
      RequestVerificationToken: session.token,
      Cookie: session.cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
    signal: AbortSignal.timeout(NCRDB_TIMEOUT_MS),
  })
}

async function searchCourses(params: SearchParams) {
  const body = searchBody(params)
  let session = await getNcrdbSession()
  let res = await postSearch(session, body)

  if (res.status === 400 || res.status === 403) {
    cachedSession = null
    session = await getNcrdbSession(true)
    res = await postSearch(session, body)
  }

  if (!res.ok) throw new Error(`NCRDB search failed: ${res.status}`)
  if (!res.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new Error('NCRDB returned non-JSON — site may have changed')
  }

  const courses = await res.json()
  return Array.isArray(courses) ? courses : []
}

const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .trim()

const toInt = (text: string) => {
  const n = parseInt(text.replace(/,/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

const toFloat = (text: string) => {
  const n = parseFloat(text.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const normalizeText = (text: string) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()

const normalizeKey = (text: string) =>
  normalizeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const validPar = (value: number | null) => Number.isInteger(value) && value >= 3 && value <= 6
const validStrokeIndex = (value: number | null) => Number.isInteger(value) && value >= 1 && value <= 18

function completeMap(values: Record<number, number>, validator: (value: number | null) => boolean) {
  const complete: Record<number, number> = {}
  for (let hole = 1; hole <= 18; hole += 1) {
    const value = values[hole]
    if (!validator(value)) return null
    complete[hole] = value
  }
  return complete
}

function parseTables(html: string): ParsedTable[] {
  const tables: ParsedTable[] = []
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi
  let match: RegExpExecArray | null
  while ((match = tableRe.exec(html))) {
    const rows = (match[1].match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [])
      .map((row) => (row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(stripTags))
      .filter((cells) => cells.length > 0)
    if (rows.length) tables.push({ rows })
  }
  return tables
}

function holeColumns(cells: string[]) {
  const columns = new Map<number, number>()
  cells.forEach((cell, index) => {
    const key = normalizeKey(cell)
    const match = key.match(/^(?:hole )?([1-9]|1[0-8])$/)
    if (!match) return
    columns.set(index, Number(match[1]))
  })
  return columns
}

function valuesByHole(cells: string[], columns: Map<number, number>) {
  const values: Record<number, number> = {}
  for (const [index, hole] of columns) {
    const value = toInt(cells[index] ?? '')
    if (value != null) values[hole] = value
  }
  return values
}

function isMaleRow(label: string) {
  const key = normalizeKey(label)
  const words = key.split(' ')
  return words.includes('men') || words.includes('mens') || words.includes('male') || key === 'm'
}

function isFemaleRow(label: string) {
  const key = normalizeKey(label)
  const words = key.split(' ')
  return words.includes('women') || words.includes('womens') || words.includes('ladies') || words.includes('female') || key === 'f'
}

function isParRow(label: string) {
  const key = normalizeKey(label)
  return key === 'par' || key.endsWith(' par')
}

function isStrokeIndexRow(label: string) {
  const key = normalizeKey(label)
  return (
    key.includes('stroke index') ||
    key.includes('handicap') ||
    key.includes('hdcp') ||
    key.includes('hcp') ||
    key.includes('allocation')
  )
}

function firstHeaderColumn(headers: string[], matcher: (header: string) => boolean) {
  const index = headers.findIndex((header) => matcher(normalizeHeader(header)))
  return index >= 0 ? index : null
}

function parseRowScorecard(table: ParsedTable): Scorecard | null {
  for (let headerIndex = 0; headerIndex < table.rows.length; headerIndex += 1) {
    const columns = holeColumns(table.rows[headerIndex])
    if (columns.size < 9) continue

    let pars: Record<number, number> | null = null
    let maleStrokeIndex: Record<number, number> | null = null
    let fallbackStrokeIndex: Record<number, number> | null = null

    for (const cells of table.rows.slice(headerIndex + 1)) {
      const label = cells.find((cell) => normalizeText(cell)) ?? ''
      const values = valuesByHole(cells, columns)
      if (isParRow(label) && !pars) {
        pars = completeMap(values, validPar)
      }
      if (isStrokeIndexRow(label)) {
        const strokeIndex = completeMap(values, validStrokeIndex)
        if (strokeIndex && isMaleRow(label)) maleStrokeIndex = strokeIndex
        else if (strokeIndex && !isFemaleRow(label) && !fallbackStrokeIndex) fallbackStrokeIndex = strokeIndex
      }
    }

    if (pars) {
      return { pars, strokeIndex: maleStrokeIndex ?? fallbackStrokeIndex ?? undefined }
    }
  }
  return null
}

function parseColumnScorecards(table: ParsedTable): Scorecard[] {
  const scorecards: Scorecard[] = []
  const headerIndex = table.rows.findIndex((cells) => cells.some((cell) => normalizeHeader(cell) === 'hole'))
  if (headerIndex < 0) return scorecards

  const headers = table.rows[headerIndex]
  const holeColumn = firstHeaderColumn(headers, (header) => header === 'hole')
  const parColumn = firstHeaderColumn(headers, (header) => header === 'par')
  if (holeColumn == null || parColumn == null) return scorecards

  const teeColumn = firstHeaderColumn(headers, (header) => header.startsWith('tee name') || header === 'tee')
  const genderColumn = firstHeaderColumn(headers, (header) => header.includes('gender'))
  const strokeColumn = firstHeaderColumn(headers, (header) =>
    header.includes('stroke index') ||
    header.includes('handicap') ||
    header.includes('hdcp') ||
    header.includes('hcp') ||
    header.includes('allocation')
  )

  const groups = new Map<string, {
    teeName?: string
    gender?: string
    pars: Record<number, number>
    strokeIndex: Record<number, number>
  }>()

  for (const cells of table.rows.slice(headerIndex + 1)) {
    const hole = toInt(cells[holeColumn] ?? '')
    const par = toInt(cells[parColumn] ?? '')
    if (!Number.isInteger(hole) || hole < 1 || hole > 18 || !validPar(par)) continue

    const teeName = teeColumn == null ? undefined : normalizeText(cells[teeColumn] ?? '')
    const gender = genderColumn == null ? undefined : normalizeText(cells[genderColumn] ?? '')
    const key = `${normalizeKey(teeName ?? '')}|${normalizeKey(gender ?? '')}`
    const group = groups.get(key) ?? { teeName, gender, pars: {}, strokeIndex: {} }
    group.pars[hole] = par as number

    if (strokeColumn != null) {
      const strokeIndex = toInt(cells[strokeColumn] ?? '')
      if (validStrokeIndex(strokeIndex)) group.strokeIndex[hole] = strokeIndex as number
    }

    groups.set(key, group)
  }

  for (const group of groups.values()) {
    const pars = completeMap(group.pars, validPar)
    if (!pars) continue
    const strokeIndex = completeMap(group.strokeIndex, validStrokeIndex) ?? undefined
    scorecards.push({ teeName: group.teeName, gender: group.gender, pars, strokeIndex })
  }

  return scorecards
}

function parseScorecards(html: string): Scorecard[] {
  const scorecards: Scorecard[] = []
  for (const table of parseTables(html)) {
    const rowScorecard = parseRowScorecard(table)
    if (rowScorecard) scorecards.push(rowScorecard)
    scorecards.push(...parseColumnScorecards(table))
  }
  return scorecards
}

function scorecardKey(teeName?: string, gender?: string) {
  return `${normalizeKey(teeName ?? '')}|${normalizeKey(gender ?? '')}`
}

function scorecardForTee(scorecards: Scorecard[], tee: { name: string, gender: string }) {
  return (
    scorecards.find((card) => card.teeName && scorecardKey(card.teeName, card.gender) === scorecardKey(tee.name, tee.gender)) ??
    scorecards.find((card) => card.teeName && normalizeKey(card.teeName) === normalizeKey(tee.name)) ??
    scorecards.find((card) => !card.teeName) ??
    null
  )
}

function holesFromScorecard(scorecard: Scorecard | null) {
  if (!scorecard) return null
  return Array.from({ length: 18 }, (_, index) => {
    const hole = index + 1
    return {
      hole,
      par: scorecard.pars[hole],
      ...(scorecard.strokeIndex?.[hole] != null ? { strokeIndex: scorecard.strokeIndex[hole] } : {}),
    }
  })
}

/**
 * courseTeeInfo returns a full HTML page; tee sets live in <table id="gvTee">.
 * Columns are mapped from the header row so USGA column insertions do not
 * silently corrupt tee ids, slopes, or yardages.
 */
function parseTeeTable(html: string) {
  const table = html.match(/<table\b[^>]*\bid=["']?gvTee["']?[^>]*>([\s\S]*?)<\/table>/i)
  if (!table) throw new Error(TEE_TABLE_STRUCTURE_ERROR)

  const rows = table[1].match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []
  const parsedRows = rows.map((row) => (row.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map(stripTags))
  const headerRowIndex = parsedRows.findIndex((cells) => normalizeHeader(cells[0]).startsWith('tee name'))
  if (headerRowIndex < 0) throw new Error(TEE_TABLE_STRUCTURE_ERROR)

  const headerCells = parsedRows[headerRowIndex]
  const column = {
    name: findHeaderColumn(headerCells, (header) => header.startsWith('tee name')),
    gender: findHeaderColumn(headerCells, (header) => header.includes('gender')),
    par: findHeaderColumn(headerCells, (header) => header === 'par'),
    courseRating: findHeaderColumn(
      headerCells,
      (header) => header.startsWith('course rating') && !header.includes('f9') && !header.includes('b9')
    ),
    bogeyRating: findHeaderColumn(
      headerCells,
      (header) => header.startsWith('bogey rating') && !header.includes('f9') && !header.includes('b9')
    ),
    slope: findHeaderColumn(
      headerCells,
      (header) => header.startsWith('slope rating') && !header.includes('f9') && !header.includes('b9')
    ),
    teeId: findHeaderColumn(headerCells, (header) => header.replace(/\s/g, '') === 'teeid'),
    yards: findHeaderColumn(headerCells, (header) => header.includes('length')),
  }

  const tees = []
  const lastRequiredColumn = Math.max(...Object.values(column))
  const scorecards = parseScorecards(html)
  for (const cells of parsedRows.slice(headerRowIndex + 1)) {
    if (cells.length <= lastRequiredColumn) continue
    const name = cells[column.name]
    if (!name) continue
    const gender = cells[column.gender]
    const scorecard = scorecardForTee(scorecards, { name, gender })
    const holes = holesFromScorecard(scorecard)
    tees.push({
      name,
      gender,
      par: toInt(cells[column.par]),
      courseRating: toFloat(cells[column.courseRating]),
      bogeyRating: toFloat(cells[column.bogeyRating]),
      slope: toInt(cells[column.slope]),
      yards: toInt(cells[column.yards]),
      teeId: toInt(cells[column.teeId]),
      ...(holes ? { holes, pars: scorecard?.pars, strokeIndex: scorecard?.strokeIndex } : {}),
    })
  }
  return tees
}

const normalizeHeader = (text: string) =>
  String(text ?? '')
    .replace(/[™®]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

function findHeaderColumn(headers: string[], matcher: (header: string) => boolean) {
  const index = headers.findIndex((header) => matcher(normalizeHeader(header)))
  if (index < 0) throw new Error(TEE_TABLE_STRUCTURE_ERROR)
  return index
}

async function fetchTees(courseId: number) {
  const res = await fetch(`${NCRDB_BASE}/courseTeeInfo?CourseID=${courseId}`, {
    signal: AbortSignal.timeout(NCRDB_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`NCRDB tee fetch failed: ${res.status}`)
  return parseTeeTable(await res.text())
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_body', message: 'Expected a JSON body.' }, 400)
  }

  try {
    if (body?.action === 'search') {
      const clubName = String(body.clubName ?? '').trim()
      const clubCity = String(body.clubCity ?? '').trim()
      const clubState = String(body.clubState ?? '').trim()
      if (!clubName && !clubCity && !clubState) {
        return jsonResponse(
          { error: 'invalid_request', message: 'clubName, clubCity, or clubState is required.' },
          400,
        )
      }
      const courses = await searchCourses(body as SearchParams)
      return jsonResponse({ courses })
    }

    if (body?.action === 'tees') {
      const courseId = Number(body.courseId)
      if (!Number.isInteger(courseId) || courseId <= 0) {
        return jsonResponse({ error: 'invalid_request', message: 'courseId must be a positive number.' }, 400)
      }
      const tees = await fetchTees(courseId)
      return jsonResponse({ tees })
    }

    return jsonResponse({ error: 'invalid_request', message: 'action must be "search" or "tees".' }, 400)
  } catch (err) {
    console.error('[ncrdb-course-search]', err)
    const message = err instanceof Error ? err.message : 'NCRDB request failed'
    return jsonResponse({ error: 'ncrdb_failed', message }, 502)
  }
})
