exports.up = function(knex) {
  return knex.schema.withSchema('ema')
    .alterTable('formula_resultado', (table) => {
      table.integer('id_usuario_evaluador').references('id').inTable('public.users').nullable();
      table.text('manual_comment').nullable();
      table.text('resultado_consultor').nullable();
      table.timestamp('fecha_manual_evaluacion').nullable();
    });
};

exports.down = function(knex) {
  return knex.schema.withSchema('ema')
    .alterTable('formula_resultado', (table) => {
      table.dropColumn('id_usuario_evaluador');
      table.dropColumn('manual_comment');
      table.dropColumn('resultado_consultor');
      table.dropColumn('fecha_manual_evaluacion');
    });
};
