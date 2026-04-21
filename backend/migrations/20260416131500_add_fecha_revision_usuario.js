exports.up = function(knex) {
  return knex.raw(`
    ALTER TABLE ema.formula_resultado
      ADD COLUMN IF NOT EXISTS cambio_detectado   boolean   NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS manual_override    boolean   NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS fecha_revision_usuario timestamptz NULL;
  `);
};

exports.down = function(knex) {
  return knex.raw(`
    ALTER TABLE ema.formula_resultado
      DROP COLUMN IF EXISTS cambio_detectado,
      DROP COLUMN IF EXISTS manual_override,
      DROP COLUMN IF EXISTS fecha_revision_usuario;
  `);
};

