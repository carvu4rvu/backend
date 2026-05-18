const pool = require('../config/db');
const logger = require('../utils/logger');

const PG_CHUNK = 400;
const SQL_SLOW_MS = Number(process.env.SQL_SLOW_MS) || 200;
const SQL_LOG_ALL = process.env.SQL_LOG === 'all' || process.env.SQL_LOG === '1';

function logQueryTiming(ms, text) {
  if (!SQL_LOG_ALL && ms < SQL_SLOW_MS) return;
  const preview = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  const tag = ms >= SQL_SLOW_MS ? 'slow' : 'sql';
  logger.info(`[SQL:${tag}] ${ms}ms ${preview}`);
}

async function execQuery(text, params = []) {
  const start = Date.now();
  try {
    return await pool.query(text, params);
  } finally {
    logQueryTiming(Date.now() - start, text);
  }
}

function chunkArray(arr, size = PG_CHUNK) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function query(text, params = []) {
  return execQuery(text, params);
}

async function queryOne(text, params = []) {
  const { rows } = await execQuery(text, params);
  return rows[0] ?? null;
}

async function queryMany(text, params = []) {
  const { rows } = await execQuery(text, params);
  return rows;
}

/** Run callback per chunk of values for ANY($1) queries. */
async function forEachChunk(values, fn, chunkSize = PG_CHUNK) {
  const results = [];
  for (const chunk of chunkArray(values, chunkSize)) {
    if (!chunk.length) continue;
    const part = await fn(chunk);
    if (Array.isArray(part)) results.push(...part);
  }
  return results;
}

async function queryIn(table, columns, idColumn, ids, extraWhere = '') {
  if (!ids?.length) return [];
  return forEachChunk(ids, async (chunk) => {
    const { rows } = await execQuery(
      `SELECT ${columns} FROM ${table} WHERE ${idColumn} = ANY($1::int[])${extraWhere}`,
      [chunk]
    );
    return rows;
  });
}

async function queryInText(table, columns, idColumn, ids, extraWhere = '') {
  if (!ids?.length) return [];
  return forEachChunk(ids, async (chunk) => {
    const { rows } = await execQuery(
      `SELECT ${columns} FROM ${table} WHERE ${idColumn} = ANY($1::text[])${extraWhere}`,
      [chunk]
    );
    return rows;
  });
}

function dbError(err, fallback = 'Database error') {
  const message = err?.message || fallback;
  logger.error('[db]', message);
  return { message, code: err?.code };
}

module.exports = {
  pool,
  query,
  queryOne,
  queryMany,
  forEachChunk,
  chunkArray,
  queryIn,
  queryInText,
  dbError,
  PG_CHUNK,
};
