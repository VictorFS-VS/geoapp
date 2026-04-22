// migrations/2025080815_create_proyectos.js

exports.up = async function(knex) {
  // Asegura esquema y extensión PostGIS
  await knex.raw('CREATE SCHEMA IF NOT EXISTS ema');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS postgis');

  // Asegura secuencia para gid
  await knex.raw("CREATE SEQUENCE IF NOT EXISTS ema.proyectos_gid_seq");

  // Crea tabla proyectos solo si no existe
  const hasTable = await knex.schema.withSchema('ema').hasTable('proyectos');
  if (!hasTable) {
    await knex.schema
      .withSchema('ema')
      .createTable('proyectos', table => {
        table.integer('gid').primary().notNullable()
             .defaultTo(knex.raw("nextval('ema.proyectos_gid_seq'::regclass)"));
        table.string('tipo_estudio', 150);
        table.string('actividad',    200);
        table.string('expediente',   20);
        table.string('nombre',       100);
        table.string('codigo',       10).unique();
        table.specificType('geom',   'geometry(MultiPolygon)');
        table.string('descripcion',  550);
        table.date('fecha_inicio');
        table.date('fecha_final');
        table.date('fecha_registro');
        table.string('id_grupoproyecto', 30);
        table.string('tipo_proyecto',     30);
        table.integer('id_proponente');
        table.integer('id_consultor');
        table.string('padron', 100);
        table.string('cta_cte', 20);
        table.string('finca',   20);
        table.string('matricula', 100);
        table.string('expediente_hidrico', 20);
        table.string('estado',   10);
        table.integer('col_cod');
        table.decimal('exp_gestion', 4, 0);
        table.decimal('exp_numero',  7, 0);
        table.string('dpto',       150);
        table.string('distrito',   150);
        table.string('localidad',  150);
        table.decimal('coor_x', 12, 9);
        table.decimal('coor_y', 12, 9);
        table.integer('id_cliente');
        table.string('barrio', 150);
        table.string('sector_proyecto', 100);
        table.string('tipo_pga', 15);
        table.string('nro_resolucion_pga', 50);
        table.decimal('gestion_resolucion_pga', 4, 0);
        table.text('observacion_pga');
        table.string('mesa_control', 50);
        table.date('mesa_fecha_ini');
        table.date('mesa_fecha_pago');
        table.text('mesa_obs');
        table.string('mesa_usu_modif', 50);
        table.string('atec_ini', 2);
        table.date('atec_ini_fecha');
        table.text('atec_ini_obs');
        table.string('atec_ini_usu_modif', 50);
        table.string('geomatica', 50);
        table.date('geo_fecha_ini');
        table.text('geo_obs');
        table.string('geo_usu_modif', 50);
        table.string('atecnico', 50);
        table.date('atec_fecha_ini');
        table.date('atec_fecha_fin');
        table.text('atec_obs');
        table.string('direc_mades', 50);
        table.string('atec_usu_modif', 50);
        table.string('rima_p', 50);
        table.date('rima_p_fecha');
        table.text('rima_p_obs');
        table.string('rima_p_usu_modif', 50);
        table.string('rima_w', 50);
        table.date('rima_w_fecha');
        table.text('rima_w_obs');
        table.string('rima_w_usu_modif', 50);
        table.string('diva', 50);
        table.date('diva_fecha_ini');
        table.text('diva_obs');
        table.string('diva_usu_modif', 50);
        table.string('dir_gen', 50);
        table.date('dir_gen_fecha_ini');
        table.text('dir_gen_obs');
        table.string('dir_gen_usu_modif', 50);
        table.string('des_estado', 100);
        table.string('man', 255);
        table.date('man_fecha');
        table.string('man_obs', 500);
        table.string('man_usu_modif', 255);
        table.string('pga', 255);
        table.date('pga_fecha');
        table.string('pga_obs', 500);
        table.string('pga_usu_modif', 255);
        table.string('dia', 255);
        table.date('dia_fecha');
        table.string('dia_obs', 500);
        table.string('dia_usu_modif', 255);
        table.string('resol', 255);
        table.date('resol_fecha');
        table.string('resol_obs', 500);
        table.string('resol_usu_modif', 255);
      });

    // 3) Índice espacial si no existe
    await knex.raw(`CREATE INDEX IF NOT EXISTS proyectos_geom_idx ON ema.proyectos USING GIST (geom)`);

    // 4) Triggers
    await knex.raw(`DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='tgr_proyectos') THEN
      CREATE TRIGGER tgr_proyectos
        BEFORE INSERT OR DELETE OR UPDATE ON ema.proyectos
        FOR EACH ROW EXECUTE FUNCTION ema.f_trg_proyectos();
    END IF; END$$`);

    await knex.raw(`DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trigger_proyectos_1_seg_estado') THEN
      CREATE TRIGGER trigger_proyectos_1_seg_estado
        BEFORE INSERT OR UPDATE ON ema.proyectos
        FOR EACH ROW EXECUTE FUNCTION ema.proyectos_seg_estado();
    END IF; END$$`);

    await knex.raw(`DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trigger_proyectos_evaluaciones') THEN
      CREATE TRIGGER trigger_proyectos_evaluaciones
        AFTER INSERT OR UPDATE ON ema.proyectos
        FOR EACH ROW EXECUTE FUNCTION ema.f_proyectos_evaluaciones();
    END IF; END$$`);
  }
};

exports.down = async function(knex) {
  // Eliminar triggers si existen
  await knex.raw(`DROP TRIGGER IF EXISTS trigger_proyectos_evaluaciones ON ema.proyectos`);
  await knex.raw(`DROP TRIGGER IF EXISTS trigger_proyectos_1_seg_estado ON ema.proyectos`);
  await knex.raw(`DROP TRIGGER IF EXISTS tgr_proyectos ON ema.proyectos`);

  // Eliminar índice espacial
  await knex.raw(`DROP INDEX IF EXISTS ema.proyectos_geom_idx`);

  // Eliminar tabla si existe
  await knex.schema.withSchema('ema').dropTableIfExists('proyectos');

  // Eliminar secuencia si existe
  await knex.raw(`DROP SEQUENCE IF EXISTS ema.proyectos_gid_seq`);
};
