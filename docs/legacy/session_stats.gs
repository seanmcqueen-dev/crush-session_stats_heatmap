/**
 * Pitch Tracker - Session Stats Engine
 *
 * DROP-IN REPLACEMENT
 *
 * What this version does:
 * 1) Watches Sessions for edits to:
 *      - StatsPitcherID
 *      - CurrentPitcherID
 * 2) Recomputes stats for that SessionID + selected PitcherID
 * 3) Upserts one row into SessionPitcherStats
 * 4) Writes the selected stats back to the Sessions row
 *    so existing Glide screens still work
 *
 * Expected sheets:
 *   Sessions
 *   Pitches
 *   SessionPitcherStats
 *
 * Sessions required headers:
 *   SessionID
 *   CurrentPitcherID
 *   StatsPitcherID
 *   StatsTotalPitches
 *   StatsStrikes
 *   StatsBalls
 *   StatsPoints
 *   StatsDirectHits
 *   StatsNeighborHits
 *   StatsMisses
 *   T1_Direct ... T9_Direct
 *   T1_Neighbor ... T9_Neighbor
 *   T1_Miss ... T9_Miss
 *   SessionStatsEmbedURL
 *
 * Pitches required headers:
 *   SessionID
 *   PitcherID
 *   TargetZone
 *   ActualZone
 *   IsBall
 *   Points
 *   IsDeleted
 *
 * SessionPitcherStats required headers:
 *   SessionID
 *   PitcherID
 *   TotalPitches
 *   Strikes
 *   Balls
 *   Points
 *   DirectHits
 *   NeighborHits
 *   Misses
 *   T1_Direct ... T9_Direct
 *   T1_Neighbor ... T9_Neighbor
 *   T1_Miss ... T9_Miss
 */

const CONFIG = {
  SESSIONS_SHEET: 'Sessions',
  PITCHES_SHEET: 'Pitches',
  SESSION_PITCHER_STATS_SHEET: 'SessionPitcherStats',

  HEATMAP_BASE_URL: 'https://seanmcqueen-dev.github.io/crush-session_stats_heatmap/',

  // If StatsPitcherID is blank, use CurrentPitcherID
  FALLBACK_TO_CURRENT_PITCHER: true
};


/**
 * Installable trigger entry point
 * Trigger type: From spreadsheet -> On edit
 */
function onEdit(e) {
  if (!e || !e.range || !e.source) return;

  try {
    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();

    if (sheetName === CONFIG.SESSIONS_SHEET) {
      handleSessionsEdit_(e);
      return;
    }

    // Optional:
    // If you later want pitch entry edits to auto-refresh the currently selected
    // session row, we can add that here. Leaving it out for now keeps this focused.
  } catch (err) {
    console.error('onEdit error: ' + err);
  }
}


/**
 * Manual runner for active row on Sessions sheet.
 * Useful for testing.
 */
function recomputeActiveSessionRow() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getActiveSheet();
  if (sheet.getName() !== CONFIG.SESSIONS_SHEET) {
    throw new Error('Active sheet must be "' + CONFIG.SESSIONS_SHEET + '"');
  }

  const row = sheet.getActiveRange().getRow();
  if (row <= 1) throw new Error('Select a data row, not the header.');

  recomputeSessionStatsForRow_(ss, row);
}


/**
 * Manual backfill runner.
 * Recomputes SessionPitcherStats for every distinct non-deleted SessionID + PitcherID
 * found in Pitches, then refreshes all Sessions rows.
 *
 * Run this once if you want to build historical stats rows from existing pitch data.
 */
function backfillAllSessionPitcherStats() {
  const ss = SpreadsheetApp.getActive();
  const pitchesSheet = ss.getSheetByName(CONFIG.PITCHES_SHEET);
  const statsSheet = ss.getSheetByName(CONFIG.SESSION_PITCHER_STATS_SHEET);
  const sessionsSheet = ss.getSheetByName(CONFIG.SESSIONS_SHEET);

  if (!pitchesSheet) throw new Error('Missing sheet: ' + CONFIG.PITCHES_SHEET);
  if (!statsSheet) throw new Error('Missing sheet: ' + CONFIG.SESSION_PITCHER_STATS_SHEET);
  if (!sessionsSheet) throw new Error('Missing sheet: ' + CONFIG.SESSIONS_SHEET);

  const pitchData = getAllPitchData_(pitchesSheet);
  const uniquePairs = getDistinctSessionPitcherPairs_(pitchData.rows, pitchData.col);

  uniquePairs.forEach(pair => {
    const filtered = filterPitchRows_(pitchData.rows, pitchData.col, pair.sessionId, pair.pitcherId);
    const stats = computePitchStats_(filtered);
    upsertSessionPitcherStatsRow_(statsSheet, pair.sessionId, pair.pitcherId, stats);
  });

  refreshAllSessionsFromStats_();
}


/**
 * Refreshes all Sessions rows based on their selected StatsPitcherID / CurrentPitcherID
 * from SessionPitcherStats.
 */
function refreshAllSessionsFromStats_() {
  const ss = SpreadsheetApp.getActive();
  const sessionsSheet = ss.getSheetByName(CONFIG.SESSIONS_SHEET);
  if (!sessionsSheet) throw new Error('Missing sheet: ' + CONFIG.SESSIONS_SHEET);

  const lastRow = sessionsSheet.getLastRow();
  if (lastRow < 2) return;

  for (let row = 2; row <= lastRow; row++) {
    recomputeSessionStatsForRow_(ss, row);
  }
}


/**
 * Handles edits on Sessions sheet.
 */
function handleSessionsEdit_(e) {
  const sheet = e.range.getSheet();
  const row = e.range.getRow();
  if (row === 1) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = getColumnMap_(headers);

  const watchedCols = [
    col['StatsPitcherID'],
    col['CurrentPitcherID']
  ].filter(Boolean);

  const editedCol = e.range.getColumn();
  if (!watchedCols.includes(editedCol)) return;

  recomputeSessionStatsForRow_(e.source, row);
}


/**
 * Main controller for one Sessions row.
 *
 * Flow:
 * - Read SessionID and selected pitcher
 * - Read matching pitches
 * - Compute stats
 * - Upsert SessionPitcherStats row
 * - Write current selected stats back to Sessions row
 */
function recomputeSessionStatsForRow_(ss, sessionRow) {
  const sessionsSheet = ss.getSheetByName(CONFIG.SESSIONS_SHEET);
  const pitchesSheet = ss.getSheetByName(CONFIG.PITCHES_SHEET);
  const statsSheet = ss.getSheetByName(CONFIG.SESSION_PITCHER_STATS_SHEET);

  if (!sessionsSheet) throw new Error('Missing sheet: ' + CONFIG.SESSIONS_SHEET);
  if (!pitchesSheet) throw new Error('Missing sheet: ' + CONFIG.PITCHES_SHEET);
  if (!statsSheet) throw new Error('Missing sheet: ' + CONFIG.SESSION_PITCHER_STATS_SHEET);

  const sessionsHeaders = sessionsSheet.getRange(1, 1, 1, sessionsSheet.getLastColumn()).getValues()[0];
  const sessionsCol = getColumnMap_(sessionsHeaders);

  const sessionRowValues = sessionsSheet.getRange(sessionRow, 1, 1, sessionsSheet.getLastColumn()).getValues()[0];
  const sessionId = normalizeValue_(getCellByHeader_(sessionRowValues, sessionsCol, 'SessionID'));
  const statsPitcherId = normalizeValue_(getCellByHeader_(sessionRowValues, sessionsCol, 'StatsPitcherID'));
  const currentPitcherId = normalizeValue_(getCellByHeader_(sessionRowValues, sessionsCol, 'CurrentPitcherID'));

  const pitcherId = statsPitcherId || (CONFIG.FALLBACK_TO_CURRENT_PITCHER ? currentPitcherId : '');

  if (!sessionId || !pitcherId) {
    clearSessionDisplayStatsForRow_(sessionsSheet, sessionRow, sessionsCol);
    return;
  }

  const pitchData = getAllPitchData_(pitchesSheet);
  const pitchRows = filterPitchRows_(pitchData.rows, pitchData.col, sessionId, pitcherId);
  const stats = computePitchStats_(pitchRows);

  upsertSessionPitcherStatsRow_(statsSheet, sessionId, pitcherId, stats);

  const embedUrl = buildSessionStatsEmbedUrl_(stats);
  writeSessionDisplayStatsToRow_(sessionsSheet, sessionRow, sessionsCol, stats, embedUrl);
}


/**
 * Reads all pitch data once.
 */
function getAllPitchData_(pitchesSheet) {
  const lastRow = pitchesSheet.getLastRow();
  const lastCol = pitchesSheet.getLastColumn();

  const headers = pitchesSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = getColumnMap_(headers);

  const required = ['SessionID', 'PitcherID', 'TargetZone', 'ActualZone', 'IsBall', 'Points', 'IsDeleted'];
  required.forEach(name => {
    if (!col[name]) throw new Error('Missing Pitches header: ' + name);
  });

  const rows = lastRow >= 2
    ? pitchesSheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
    : [];

  return { headers, col, rows };
}


/**
 * Filters pitch rows for one SessionID + PitcherID, skipping deleted.
 */
function filterPitchRows_(rows, col, sessionId, pitcherId) {
  const out = [];
  const normSessionId = normalizeValue_(sessionId);
  const normPitcherId = normalizeValue_(pitcherId);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    const rowSessionId = normalizeValue_(row[col['SessionID'] - 1]);
    const rowPitcherId = normalizeValue_(row[col['PitcherID'] - 1]);
    const isDeleted = toBoolean_(row[col['IsDeleted'] - 1]);

    if (isDeleted) continue;
    if (rowSessionId !== normSessionId) continue;
    if (rowPitcherId !== normPitcherId) continue;

    out.push({
      targetZone: toZoneNumber_(row[col['TargetZone'] - 1]),
      actualZone: toZoneNumber_(row[col['ActualZone'] - 1]),
      isBall: toBoolean_(row[col['IsBall'] - 1]),
      points: toNumber_(row[col['Points'] - 1])
    });
  }

  return out;
}


/**
 * Returns distinct SessionID + PitcherID pairs from non-deleted pitches.
 */
function getDistinctSessionPitcherPairs_(rows, col) {
  const seen = {};
  const out = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isDeleted = toBoolean_(row[col['IsDeleted'] - 1]);
    if (isDeleted) continue;

    const sessionId = normalizeValue_(row[col['SessionID'] - 1]);
    const pitcherId = normalizeValue_(row[col['PitcherID'] - 1]);
    if (!sessionId || !pitcherId) continue;

    const key = sessionId + '||' + pitcherId;
    if (seen[key]) continue;

    seen[key] = true;
    out.push({ sessionId, pitcherId });
  }

  return out;
}


/**
 * Computes total stats and target-zone stats.
 */
function computePitchStats_(pitchRows) {
  const stats = {
    totalPitches: 0,
    strikes: 0,
    balls: 0,
    points: 0,
    directHits: 0,
    neighborHits: 0,
    misses: 0,
    zones: {}
  };

  for (let z = 1; z <= 9; z++) {
    stats.zones[z] = {
      direct: 0,
      neighbor: 0,
      miss: 0
    };
  }

  for (const pitch of pitchRows) {
    stats.totalPitches++;
    stats.points += toNumber_(pitch.points);

    const targetZone = pitch.targetZone;
    const isBall = pitch.isBall;
    const points = toNumber_(pitch.points);

    if (isBall) {
      stats.balls++;
      stats.misses++;
      if (targetZone >= 1 && targetZone <= 9) {
        stats.zones[targetZone].miss++;
      }
      continue;
    }

    stats.strikes++;

    if (points === 3) {
      stats.directHits++;
      if (targetZone >= 1 && targetZone <= 9) {
        stats.zones[targetZone].direct++;
      }
    } else if (points === 1) {
      stats.neighborHits++;
      if (targetZone >= 1 && targetZone <= 9) {
        stats.zones[targetZone].neighbor++;
      }
    } else {
      stats.misses++;
      if (targetZone >= 1 && targetZone <= 9) {
        stats.zones[targetZone].miss++;
      }
    }
  }

  return stats;
}


/**
 * Upserts one row into SessionPitcherStats by SessionID + PitcherID.
 */
function upsertSessionPitcherStatsRow_(statsSheet, sessionId, pitcherId, stats) {
  const lastCol = statsSheet.getLastColumn();
  const headers = statsSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = getColumnMap_(headers);

  const required = [
    'SessionID', 'PitcherID',
    'TotalPitches', 'Strikes', 'Balls', 'Points',
    'DirectHits', 'NeighborHits', 'Misses'
  ];

  required.forEach(name => {
    if (!col[name]) throw new Error('Missing SessionPitcherStats header: ' + name);
  });

  const targetRow = findSessionPitcherStatsRow_(statsSheet, col, sessionId, pitcherId);
  const rowValues = new Array(lastCol).fill('');

  setCellByHeader_(rowValues, col, 'SessionID', sessionId);
  setCellByHeader_(rowValues, col, 'PitcherID', pitcherId);
  setCellByHeader_(rowValues, col, 'TotalPitches', stats.totalPitches);
  setCellByHeader_(rowValues, col, 'Strikes', stats.strikes);
  setCellByHeader_(rowValues, col, 'Balls', stats.balls);
  setCellByHeader_(rowValues, col, 'Points', stats.points);
  setCellByHeader_(rowValues, col, 'DirectHits', stats.directHits);
  setCellByHeader_(rowValues, col, 'NeighborHits', stats.neighborHits);
  setCellByHeader_(rowValues, col, 'Misses', stats.misses);

  for (let z = 1; z <= 9; z++) {
    setCellByHeader_(rowValues, col, `T${z}_Direct`, stats.zones[z].direct);
    setCellByHeader_(rowValues, col, `T${z}_Neighbor`, stats.zones[z].neighbor);
    setCellByHeader_(rowValues, col, `T${z}_Miss`, stats.zones[z].miss);
  }

  if (targetRow) {
    statsSheet.getRange(targetRow, 1, 1, lastCol).setValues([rowValues]);
  } else {
    statsSheet.appendRow(rowValues);
  }
}


/**
 * Finds existing SessionPitcherStats row for SessionID + PitcherID.
 * Returns row number or 0 if not found.
 */
function findSessionPitcherStatsRow_(statsSheet, col, sessionId, pitcherId) {
  const lastRow = statsSheet.getLastRow();
  if (lastRow < 2) return 0;

  const data = statsSheet.getRange(2, 1, lastRow - 1, statsSheet.getLastColumn()).getValues();
  const normSessionId = normalizeValue_(sessionId);
  const normPitcherId = normalizeValue_(pitcherId);

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowSessionId = normalizeValue_(row[col['SessionID'] - 1]);
    const rowPitcherId = normalizeValue_(row[col['PitcherID'] - 1]);

    if (rowSessionId === normSessionId && rowPitcherId === normPitcherId) {
      return i + 2;
    }
  }

  return 0;
}


/**
 * Builds final heatmap URL.
 *
 * goal = total pitches * 3
 */
function buildSessionStatsEmbedUrl_(stats) {
  const goal = stats.totalPitches * 3;

  const pairs = [
    ['goal', goal],
    ['count', stats.totalPitches],
    ['strikes', stats.strikes],
    ['balls', stats.balls],
    ['points', stats.points],
    ['directHits', stats.directHits],
    ['neighborHits', stats.neighborHits],
    ['misses', stats.misses]
  ];

  for (let z = 1; z <= 9; z++) {
    pairs.push([`d${z}`, stats.zones[z].direct]);
    pairs.push([`n${z}`, stats.zones[z].neighbor]);
    pairs.push([`m${z}`, stats.zones[z].miss]);
  }

  const query = pairs
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
    .join('&');

  return CONFIG.HEATMAP_BASE_URL + '?' + query;
}

function recomputeSessionStatsBySessionId_(ss, sessionId) {
  const sessionsSheet = ss.getSheetByName(CONFIG.SESSIONS_SHEET);
  if (!sessionsSheet) throw new Error('Missing sheet: ' + CONFIG.SESSIONS_SHEET);

  const lastRow = sessionsSheet.getLastRow();
  if (lastRow < 2) throw new Error('No session rows found.');

  const headers = sessionsSheet.getRange(1, 1, 1, sessionsSheet.getLastColumn()).getValues()[0];
  const col = getColumnMap_(headers);

  const cSessionID = col['SessionID'];
  if (!cSessionID) throw new Error('Missing Sessions header: SessionID');

  const values = sessionsSheet.getRange(2, cSessionID, lastRow - 1, 1).getValues();

  for (let i = 0; i < values.length; i++) {
    const rowSessionId = normalizeValue_(values[i][0]);
    if (rowSessionId === normalizeValue_(sessionId)) {
      const actualRow = i + 2;
      recomputeSessionStatsForRow_(ss, actualRow);
      return actualRow;
    }
  }

  throw new Error('SessionID not found: ' + sessionId);
}

function refreshAllSessionsFromStats() {
  refreshAllSessionsFromStats_();
}

function debugActiveSessionRowStats() {
  const ss = SpreadsheetApp.getActive();
  const sessionsSheet = ss.getActiveSheet();
  if (sessionsSheet.getName() !== CONFIG.SESSIONS_SHEET) {
    throw new Error('Select a row on the Sessions sheet first.');
  }

  const sessionRow = sessionsSheet.getActiveRange().getRow();
  if (sessionRow <= 1) throw new Error('Select a data row, not the header.');

  const pitchesSheet = ss.getSheetByName(CONFIG.PITCHES_SHEET);

  const sessionsHeaders = sessionsSheet.getRange(1, 1, 1, sessionsSheet.getLastColumn()).getValues()[0];
  const sessionsCol = getColumnMap_(sessionsHeaders);
  const sessionRowValues = sessionsSheet.getRange(sessionRow, 1, 1, sessionsSheet.getLastColumn()).getValues()[0];

  const sessionId = normalizeValue_(getCellByHeader_(sessionRowValues, sessionsCol, 'SessionID'));
  const statsPitcherId = normalizeValue_(getCellByHeader_(sessionRowValues, sessionsCol, 'StatsPitcherID'));
  const currentPitcherId = normalizeValue_(getCellByHeader_(sessionRowValues, sessionsCol, 'CurrentPitcherID'));
  const pitcherId = statsPitcherId || (CONFIG.FALLBACK_TO_CURRENT_PITCHER ? currentPitcherId : '');

  const pitchData = getAllPitchData_(pitchesSheet);
  const pitchRows = filterPitchRows_(pitchData.rows, pitchData.col, sessionId, pitcherId);

  Logger.log('Session row: ' + sessionRow);
  Logger.log('SessionID: ' + sessionId);
  Logger.log('StatsPitcherID: ' + statsPitcherId);
  Logger.log('CurrentPitcherID: ' + currentPitcherId);
  Logger.log('Pitcher used for recompute: ' + pitcherId);
  Logger.log('Matching pitch rows found: ' + pitchRows.length);

  const rawMatches = pitchData.rows.filter(row =>
    normalizeValue_(row[pitchData.col['SessionID'] - 1]) === sessionId &&
    normalizeValue_(row[pitchData.col['PitcherID'] - 1]) === pitcherId
  );

  Logger.log('Raw matches before IsDeleted filter: ' + rawMatches.length);
  Logger.log('Sample raw matches: ' + JSON.stringify(rawMatches.slice(0, 5)));
}
/**
 * Writes selected pitcher's stats back to Sessions row.
 * This preserves your current app behavior while SessionPitcherStats becomes the source of truth.
 */
function writeSessionDisplayStatsToRow_(sessionsSheet, sessionRow, sessionsCol, stats, embedUrl) {
  const lastCol = sessionsSheet.getLastColumn();
  const existingRow = sessionsSheet.getRange(sessionRow, 1, 1, lastCol).getValues()[0];
  const outputRow = existingRow.slice();

  setCellByHeader_(outputRow, sessionsCol, 'StatsTotalPitches', stats.totalPitches);
  setCellByHeader_(outputRow, sessionsCol, 'StatsStrikes', stats.strikes);
  setCellByHeader_(outputRow, sessionsCol, 'StatsBalls', stats.balls);
  setCellByHeader_(outputRow, sessionsCol, 'StatsPoints', stats.points);
  setCellByHeader_(outputRow, sessionsCol, 'StatsDirectHits', stats.directHits);
  setCellByHeader_(outputRow, sessionsCol, 'StatsNeighborHits', stats.neighborHits);
  setCellByHeader_(outputRow, sessionsCol, 'StatsMisses', stats.misses);

  for (let z = 1; z <= 9; z++) {
    setCellByHeader_(outputRow, sessionsCol, `T${z}_Direct`, stats.zones[z].direct);
    setCellByHeader_(outputRow, sessionsCol, `T${z}_Neighbor`, stats.zones[z].neighbor);
    setCellByHeader_(outputRow, sessionsCol, `T${z}_Miss`, stats.zones[z].miss);
  }

  setCellByHeader_(outputRow, sessionsCol, 'SessionStatsEmbedURL', embedUrl);

  sessionsSheet.getRange(sessionRow, 1, 1, lastCol).setValues([outputRow]);
}

/**
 * Clears selected pitcher's display stats on Sessions row.
 */
function clearSessionDisplayStatsForRow_(sessionsSheet, sessionRow, sessionsCol) {
  const lastCol = sessionsSheet.getLastColumn();
  const existingRow = sessionsSheet.getRange(sessionRow, 1, 1, lastCol).getValues()[0];
  const outputRow = existingRow.slice();

  const headersToClear = [
    'StatsTotalPitches',
    'StatsStrikes',
    'StatsBalls',
    'StatsPoints',
    'StatsDirectHits',
    'StatsNeighborHits',
    'StatsMisses',
    'SessionStatsEmbedURL'
  ];

  for (let z = 1; z <= 9; z++) {
    headersToClear.push(`T${z}_Direct`);
    headersToClear.push(`T${z}_Neighbor`);
    headersToClear.push(`T${z}_Miss`);
  }

  headersToClear.forEach(h => setCellByHeader_(outputRow, sessionsCol, h, ''));

  sessionsSheet.getRange(sessionRow, 1, 1, lastCol).setValues([outputRow]);
}


/**
 * Header helpers
 */
function getColumnMap_(headers) {
  const map = {};
  headers.forEach((h, i) => {
    map[String(h).trim()] = i + 1;
  });
  return map;
}

function getCellByHeader_(rowValues, colMap, headerName) {
  const idx = colMap[headerName];
  if (!idx) return '';
  return rowValues[idx - 1];
}

function setCellByHeader_(rowValues, colMap, headerName, value) {
  const idx = colMap[headerName];
  if (!idx) return;
  rowValues[idx - 1] = value;
}


/**
 * Type helpers
 */
function normalizeValue_(v) {
  return String(v == null ? '' : v).trim();
}

function toBoolean_(v) {
  if (v === true) return true;
  if (v === false || v == null || v === '') return false;

  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === 'y' || s === '1';
}

function toNumber_(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function toZoneNumber_(v) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return 0;
  return n;
}
