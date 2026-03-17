// ============================================================
//  PITCH TRACKER — Session Engine v2
//  Architecture: Web App endpoint called directly by Glide Workflow
//  NO onEdit trigger — eliminates all race conditions
// ============================================================

/**
 * SETUP INSTRUCTIONS
 * ------------------
 * 1. Delete ALL existing triggers (should already be done)
 * 2. Click Deploy > New Deployment
 *    - Type: Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 3. Copy the Web App URL
 * 4. In Glide: Workflows > On form submit > Call API action
 *    - Method: POST
 *    - URL: your Web App URL
 *    - No body needed
 */

// ---- COLUMN NAME CONFIG ----
const COL = {
  S_ROWKEY:               'RowKey',
  S_SESSION_ID:           'SessionID',
  S_SESSION_START:        'SessionStart',
  S_IS_ACTIVE:            'IsActive',
  S_PARTICIPANTS_CREATED: 'ParticipantsCreated',

  P_PLAYER_ID:            'PlayerID',
  P_JERSEY:               'JerseyNumber',

  SP_SESSION_PLAYER_ID:   'SessionPlayerID',
  SP_SESSION_ID:          'SessionID',
  SP_PLAYER_ID:           'PlayerID',
  SP_IS_ACTIVE:           'IsActive',
};

const SHEET = {
  SESSIONS:        'Sessions',
  PLAYERS:         'Players',
  SESSION_PLAYERS: 'SessionPlayers',
};


// ============================================================
//  WEB APP ENTRY POINT
//  Glide calls this via HTTP POST on form submit
// ============================================================
function doPost(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : '';
    const ss = SpreadsheetApp.getActive();

    if (action === 'refresh_stats') {
      const sessionId = (e.parameter.sessionId || '').trim();
      if (!sessionId) {
        return ContentService.createTextOutput(JSON.stringify({
          status: 'error',
          message: 'Missing sessionId'
        })).setMimeType(ContentService.MimeType.JSON);
      }

      const row = recomputeSessionStatsBySessionId_(ss, sessionId);

      return ContentService.createTextOutput(JSON.stringify({
        status: 'success',
        action: 'refresh_stats',
        sessionId: sessionId,
        row: row
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // existing session creation flow
    const sessions = ss.getSheetByName(SHEET.SESSIONS);
    const headers  = getHeaders_(sessions);

    const cSessionID           = headers[COL.S_SESSION_ID];
    const cSessionStart        = headers[COL.S_SESSION_START];
    const cIsActive            = headers[COL.S_IS_ACTIVE];
    const cParticipantsCreated = headers[COL.S_PARTICIPANTS_CREATED];

    const lastRow  = sessions.getLastRow();

    let targetRow = null;
    for (let r = lastRow; r >= 2; r--) {
      const sessionID = val_(sessions, r, cSessionID);
      const participantsCreated = val_(sessions, r, cParticipantsCreated);
      if (!sessionID && !participantsCreated) {
        targetRow = r;
        break;
      }
    }

    if (!targetRow) {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        message: 'No uninitialized session row found'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const now       = new Date();
    const sessionID = 'S-' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');

    sessions.getRange(targetRow, cSessionID).setValue(sessionID);
    sessions.getRange(targetRow, cSessionStart).setValue(now);
    sessions.getRange(targetRow, cIsActive).setValue(true);
    SpreadsheetApp.flush();

    createSessionPlayers_(ss, sessionID, sessions, targetRow, cParticipantsCreated);

    return ContentService.createTextOutput(JSON.stringify({
      status: 'success',
      sessionID: sessionID,
      row: targetRow
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error(err);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
//  Also handle GET (for testing the endpoint in browser)
// ============================================================
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({
    status:  'ok',
    message: 'Pitch Tracker Session Engine is running'
  })).setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
//  CREATE SESSION PLAYERS
// ============================================================
function createSessionPlayers_(ss, sessionID, sessions, sessionsRow, cParticipantsCreated) {
  const players        = ss.getSheetByName(SHEET.PLAYERS);
  const sessionPlayers = ss.getSheetByName(SHEET.SESSION_PLAYERS);

  const pHeaders   = getHeaders_(players);
  const cPlayerID  = pHeaders[COL.P_PLAYER_ID];

  const pLastRow   = players.getLastRow();
  if (pLastRow < 2) {
    sessions.getRange(sessionsRow, cParticipantsCreated).setValue(new Date());
    return;
  }

  const playerIDs = players
    .getRange(2, cPlayerID, pLastRow - 1, 1)
    .getValues()
    .map(r => String(r[0] || '').trim())
    .filter(Boolean);

  if (playerIDs.length === 0) {
    sessions.getRange(sessionsRow, cParticipantsCreated).setValue(new Date());
    return;
  }

  // Duplicate guard
  const spHeaders    = getHeaders_(sessionPlayers);
  const cSpSessionID = spHeaders[COL.SP_SESSION_ID];

  if (cSpSessionID && sessionPlayers.getLastRow() >= 2) {
    const existing = sessionPlayers
      .getRange(2, cSpSessionID, sessionPlayers.getLastRow() - 1, 1)
      .getValues()
      .map(r => String(r[0] || '').trim());
    if (existing.includes(sessionID)) {
      sessions.getRange(sessionsRow, cParticipantsCreated).setValue(new Date());
      return;
    }
  }

  const spHeaderNames = sessionPlayers
    .getRange(1, 1, 1, sessionPlayers.getLastColumn())
    .getValues()[0];

  const newRows = playerIDs.map(pid => {
    const rowObj = {
      [COL.SP_SESSION_PLAYER_ID]: Utilities.getUuid(),
      [COL.SP_SESSION_ID]:        sessionID,
      [COL.SP_PLAYER_ID]:         pid,
      [COL.SP_IS_ACTIVE]:         true,
    };
    return spHeaderNames.map(h => rowObj[h] !== undefined ? rowObj[h] : '');
  });

  sessionPlayers
    .getRange(sessionPlayers.getLastRow() + 1, 1, newRows.length, spHeaderNames.length)
    .setValues(newRows);

  SpreadsheetApp.flush();
  sessions.getRange(sessionsRow, cParticipantsCreated).setValue(new Date());
  console.log('Created ' + newRows.length + ' SessionPlayers for ' + sessionID);
}


// ============================================================
//  POPULATE PLAYER IDs — run once manually if needed
// ============================================================
function populatePlayerIDs() {
  const ss      = SpreadsheetApp.getActive();
  const players = ss.getSheetByName(SHEET.PLAYERS);
  const headers = getHeaders_(players);
  const cPlayerID = headers[COL.P_PLAYER_ID];
  const cJersey   = headers[COL.P_JERSEY];

  const lastRow = players.getLastRow();
  for (let r = 2; r <= lastRow; r++) {
    const existing = String(players.getRange(r, cPlayerID).getValue() || '').trim();
    if (existing) continue;
    const jersey = String(players.getRange(r, cJersey).getValue() || '').trim();
    if (!jersey) continue;
    players.getRange(r, cPlayerID).setValue('P-' + jersey.padStart(2, '0'));
  }
  SpreadsheetApp.flush();
  console.log('PlayerIDs populated.');
}


// ============================================================
//  UTILITIES
// ============================================================
function getHeaders_(sheet) {
  const raw = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  raw.forEach((name, i) => { if (name) map[String(name).trim()] = i + 1; });
  return map;
}

function val_(sheet, row, col) {
  return String(sheet.getRange(row, col).getValue() || '').trim();
}
