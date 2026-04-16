exports.up = function(knex) {
  return knex.schema.withSchema('ema')
    .alterTable('formula_resultado', (table) => {
      table.jsonb('detalle_json').defaultTo('[]');
      table.boolean('manual_override').defaultTo(false);
    });
};

exports.down = function(knex) {
  return knex.schema.withSchema('ema')
    .alterTable('formula_resultado', (table) => {
      table.dropColumn('detalle_json');
      table.dropColumn('manual_override');
    });
};
