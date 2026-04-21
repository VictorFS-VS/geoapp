// migration: 20260415200000_add_descripcion_to_formula_rango.js
'use strict';

exports.up = async function(knex) {
  const exists = await knex.schema.withSchema('ema').hasColumn('formula_rango', 'descripcion');
  if (!exists) {
    await knex.schema.withSchema('ema').alterTable('formula_rango', (t) => {
      t.text('descripcion').nullable().comment('Texto interpretativo del nivel de resultado para evaluadores');
    });
  }
};

exports.down = async function(knex) {
  const exists = await knex.schema.withSchema('ema').hasColumn('formula_rango', 'descripcion');
  if (exists) {
    await knex.schema.withSchema('ema').alterTable('formula_rango', (t) => {
      t.dropColumn('descripcion');
    });
  }
};
