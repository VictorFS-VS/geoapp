/**
 * Agrega permisos específicos para diagnóstico / scoring.
 * Idempotente: no duplica códigos existentes.
 */

exports.up = async function (knex) {
  await knex.raw(`
    INSERT INTO public.permissions (code, description)
    VALUES
      ('informes.diagnostico.read',   'Ver diagnóstico / scoring de informes'),
      ('informes.diagnostico.create', 'Ejecutar diagnóstico / scoring de informes'),
      ('informes.diagnostico.update', 'Actualizar diagnóstico / scoring de informes'),
      ('informes.diagnostico.delete', 'Eliminar diagnóstico / scoring de informes')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = async function (knex) {
  await knex.raw(`
    DELETE FROM public.permissions
    WHERE code IN (
      'informes.diagnostico.read',
      'informes.diagnostico.create',
      'informes.diagnostico.update',
      'informes.diagnostico.delete'
    );
  `);
};
