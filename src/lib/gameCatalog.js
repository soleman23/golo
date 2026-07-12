/** Read-only catalogue for Commissioner's Desk Games tab (mirrors SetupWizard). */

export const SCORING_FORMATS = [
  { id: 'stroke', label: 'Stroke Play', desc: 'Count every stroke; lowest total wins the round.' },
  { id: 'matchplay', label: 'Match Play', desc: 'Win holes head-to-head, not on total strokes.' },
  { id: 'stableford', label: 'Stableford', desc: 'Earn points per hole; highest points win.' },
  { id: 'scramble', label: 'Scramble', desc: 'Play in teams — everyone hits, take the best ball.' },
]

export const GAME_TYPES = [
  { key: 'skins', appType: 'skins', title: 'Skins', desc: 'Low score wins each hole; ties carry over.' },
  { key: 'nassau', appType: 'nassau', title: 'Nassau', desc: 'Front 9, back 9 and overall match.' },
  { key: 'purse', appType: 'strokePurse', title: 'Stroke Purse', desc: 'Lowest net total takes the pot.' },
  { key: 'ctp', appType: 'ctp', title: 'Closest to Pin', desc: 'Nearest the flag on the par 3s.' },
  { key: 'longestDrive', appType: 'longestDrive', title: 'Longest Drive', desc: 'Longest tee shot on designated holes.' },
  { key: 'wolf', appType: 'wolf', title: 'Wolf', desc: 'Rotating wolf picks a partner each hole.' },
  {
    key: 'bingobangobongo',
    appType: 'bingobangobongo',
    title: 'Bingo Bango Bongo',
    desc: 'First on, closest, and first in each earn a point.',
  },
]
