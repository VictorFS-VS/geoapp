// migrations/20260331120000_add_padron_cta_to_expedientes.js

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.expedientes
      ADD COLUMN IF NOT EXISTS padron TEXT NULL,
      ADD COLUMN IF NOT EXISTS cta_cte_catastral TEXT NULL
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.expedientes
      DROP COLUMN IF EXISTS cta_cte_catastral,
      DROP COLUMN IF EXISTS padron
  `);
};
