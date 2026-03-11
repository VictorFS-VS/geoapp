// migrations/20260128_update_informe_plantilla_access.js
/**
 * Agregar control de acceso a plantillas de informes:
 * - id_creador: quién creó la plantilla
 * - proyectos_permitidos: JSONB array de gid de proyectos (NULL = todos)
 * - usuarios_compartidos: JSONB array de user IDs que pueden acceder
 */

exports.up = async function(knex) {
  const hasTable = await knex.schema.withSchema('ema').hasTable('informe_plantilla');
  
  if (hasTable) {
    const hasIdCreador = await knex.schema.withSchema('ema').hasColumn('informe_plantilla', 'id_creador');
    const hasProyectosPermitidos = await knex.schema.withSchema('ema').hasColumn('informe_plantilla', 'proyectos_permitidos');
    const hasUsuariosCompartidos = await knex.schema.withSchema('ema').hasColumn('informe_plantilla', 'usuarios_compartidos');

    if (!hasIdCreador) {
      console.log('  ✅ Agregando columna id_creador a informe_plantilla');
      await knex.schema.withSchema('ema').table('informe_plantilla', table => {
        table.integer('id_creador').nullable().comment('ID del usuario que creó la plantilla');
      });
    }

    if (!hasProyectosPermitidos) {
      console.log('  ✅ Agregando columna proyectos_permitidos a informe_plantilla');
      await knex.schema.withSchema('ema').table('informe_plantilla', table => {
        table.jsonb('proyectos_permitidos').nullable().comment('Array de gid de proyectos permitidos (NULL = todos)');
      });
    }

    if (!hasUsuariosCompartidos) {
      console.log('  ✅ Agregando columna usuarios_compartidos a informe_plantilla');
      await knex.schema.withSchema('ema').table('informe_plantilla', table => {
        table.jsonb('usuarios_compartidos').nullable().comment('Array de user IDs con los que se comparte');
      });
    }
  }
};

exports.down = async function(knex) {
  const hasTable = await knex.schema.withSchema('ema').hasTable('informe_plantilla');
  
  if (hasTable) {
    await knex.schema.withSchema('ema').table('informe_plantilla', table => {
      table.dropColumnIfExists('id_creador');
      table.dropColumnIfExists('proyectos_permitidos');
      table.dropColumnIfExists('usuarios_compartidos');
    });
  }
};
