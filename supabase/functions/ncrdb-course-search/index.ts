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
  for (const cells of parsedRows.slice(headerRowIndex + 1)) {
    if (cells.length <= lastRequiredColumn) continue
    const name = cells[column.name]
    if (!name) continue
    tees.push({
      name,
      gender: cells[column.gender],
      par: toInt(cells[column.par]),
      courseRating: toFloat(cells[column.courseRating]),
      bogeyRating: toFloat(cells[column.bogeyRating]),
      slope: toInt(cells[column.slope]),
      yards: toInt(cells[column.yards]),
      teeId: toInt(cells[column.teeId]),
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
