// migrations/20260330124500_add_tipo_poligono_to_bloques_expediente.js

exports.up = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.bloque_mejoras
      ADD COLUMN IF NOT EXISTS tipo_poligono TEXT DEFAULT 'proyecto'
  `);

  await knex.raw(`
    ALTER TABLE ema.bloque_terreno
      ADD COLUMN IF NOT EXISTS tipo_poligono TEXT DEFAULT 'proyecto'
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    ALTER TABLE ema.bloque_terreno
      DROP COLUMN IF EXISTS tipo_poligono
  `);

  await knex.raw(`
    ALTER TABLE ema.bloque_mejoras
      DROP COLUMN IF EXISTS tipo_poligono
  `);
};
