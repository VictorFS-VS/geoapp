// migrations/20260330121500_add_documentacion_presentada_to_expedientes.js

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.expedientes
      ADD COLUMN IF NOT EXISTS documentacion_presentada JSONB DEFAULT '[]'::jsonb
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.expedientes
      DROP COLUMN IF EXISTS documentacion_presentada
  `);
};
