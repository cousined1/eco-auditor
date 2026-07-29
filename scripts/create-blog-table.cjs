// One-shot script: create blog_posts table in eco-auditor's Postgres if missing.
// Run with: node scripts/create-blog-table.cjs
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blog_posts (
        id          TEXT PRIMARY KEY,
        slug        TEXT NOT NULL UNIQUE,
        target      TEXT NOT NULL,
        topic_id    TEXT NOT NULL,
        title       TEXT NOT NULL,
        meta_title  TEXT NOT NULL,
        meta_description TEXT NOT NULL,
        body_html   TEXT NOT NULL,
        primary_keyword TEXT NOT NULL,
        faq         JSONB NOT NULL DEFAULT '[]'::jsonb,
        internal_links JSONB NOT NULL DEFAULT '[]'::jsonb,
        external_links JSONB NOT NULL DEFAULT '[]'::jsonb,
        cta         JSONB NOT NULL,
        content_score INT,
        geo_score   INT,
        published_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS blog_posts_target_idx ON blog_posts(target);
      CREATE INDEX IF NOT EXISTS blog_posts_published_at_idx ON blog_posts(published_at DESC);
    `);
    const { rows } = await pool.query('SELECT count(*) FROM blog_posts');
    console.log('blog_posts table created. Row count:', rows[0].count);
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();