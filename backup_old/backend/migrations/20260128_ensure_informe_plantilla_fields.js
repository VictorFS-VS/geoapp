// migrations/20260128_ensure_informe_plantilla_fields.js
/**
 * Asegurar que la tabla informe_plantilla tiene el campo 'activo'
 * Este campo podría no existir en tablas antiguas
 */

exports.up = async function(knex) {
  const hasTable = await knex.schema.withSchema('ema').hasTable('informe_plantilla');
  
  if (hasTable) {
    const hasActivo = await knex.schema.withSchema('ema').hasColumn('informe_plantilla', 'activo');
    
    if (!hasActivo) {
      console.log('  ✅ Agregando columna activo a informe_plantilla');
      await knex.schema.withSchema('ema').table('informe_plantilla', table => {
        table.boolean('activo').defaultTo(true).nullable().comment('Indica si la plantilla está activa para usar');
      });
    }
  }
};

exports.down = async function(knex) {
  const hasTable = await knex.schema.withSchema('ema').hasTable('informe_plantilla');
  
  if (hasTable) {
    await knex.schema.withSchema('ema').table('informe_plantilla', table => {
      table.dropColumnIfExists('activo');
    });
  }
};
