exports.up = async function (knex) {
  /* =========================================================
     Tabla principal: ema.quejas_reclamos
  ========================================================= */
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ema.quejas_reclamos (
      id_queja serial PRIMARY KEY,

      id_proyecto integer NULL,
      id_tramo integer NULL,
      id_expediente integer NULL,
      id_cliente integer NULL,
      id_consultor integer NULL,

      numero varchar(30),
      codigo varchar(30),

      centro_trabajo varchar(150),
      empresa varchar(150),
      fecha_reclamo timestamp NOT NULL DEFAULT now(),
      pais varchar(100),
      linea_negocio varchar(50),

      via_recepcion varchar(50),
      desea_formular varchar(30),

      reclamante_nombre varchar(150),
      reclamante_ci varchar(30),
      direccion text,
      pk varchar(50),
      ciudad varchar(120),
      telefono varchar(50),
      email varchar(120),

      categoria_persona varchar(30),
      en_calidad varchar(30),
      nivel_riesgo varchar(20),

      tipo_vehiculo varchar(100),
      matricula varchar(30),

      tipologia varchar(100),
      descripcion text NOT NULL,

      firma_reclamante text,

      responsable_respuesta varchar(150),
      recibido_por varchar(150),
      aclaracion_recibido varchar(150),
      fecha_recibido timestamp NULL,
      fecha_respuesta timestamp NULL,
      respuesta text,
      resolucion text,

      conformidad_respuesta varchar(10) NULL,
      nivel_satisfaccion varchar(50),
      observacion_cierre text,

      estado varchar(20) NOT NULL DEFAULT 'abierto',
      fecha_cierre timestamp NULL,

      aclaracion_reclamante varchar(150),
      aclaracion_responsable varchar(150),
      ci_afectado varchar(30),
      ci_responsable varchar(30),

      firma_responsable text,

      creado_por integer NULL,
      actualizado_por integer NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),

      CONSTRAINT chk_quejas_reclamos_estado
        CHECK (estado IN ('abierto', 'en_proceso', 'respondido', 'cerrado', 'anulado')),

      CONSTRAINT chk_quejas_reclamos_linea_negocio
        CHECK (
          linea_negocio IS NULL OR
          linea_negocio IN ('corporativo', 'concesiones', 'infraestructura', 'servicios')
        ),

      CONSTRAINT chk_quejas_reclamos_via_recepcion
        CHECK (
          via_recepcion IS NULL OR
          via_recepcion IN ('telefonica', 'oficinas', 'correo_electronico')
        ),

      CONSTRAINT chk_quejas_reclamos_desea_formular
        CHECK (
          desea_formular IS NULL OR
          desea_formular IN ('quejas', 'consultas', 'solicitud', 'sugerencias')
        ),

      CONSTRAINT chk_quejas_reclamos_en_calidad
        CHECK (
          en_calidad IS NULL OR
          en_calidad IN ('ocupante', 'propietario', 'usuario', 'otros')
        ),

      CONSTRAINT chk_quejas_reclamos_nivel_riesgo
        CHECK (
          nivel_riesgo IS NULL OR
          nivel_riesgo IN ('alto', 'medio', 'bajo')
        ),

      CONSTRAINT chk_quejas_reclamos_conformidad_respuesta
        CHECK (
          conformidad_respuesta IS NULL OR
          conformidad_respuesta IN ('si', 'no', 'otro')
        ),

      CONSTRAINT chk_quejas_reclamos_nivel_satisfaccion
        CHECK (
          nivel_satisfaccion IS NULL OR
          nivel_satisfaccion IN (
            'satisfactorio',
            'parcialmente_satisfactorio',
            'insatisfactorio'
          )
        )
    );
  `);

  /* =========================================================
     Tabla archivos: ema.quejas_reclamos_archivos
  ========================================================= */
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ema.quejas_reclamos_archivos (
      id_archivo serial PRIMARY KEY,
      id_queja integer NOT NULL REFERENCES ema.quejas_reclamos(id_queja) ON DELETE CASCADE,
      nombre_archivo varchar(255),
      ruta_archivo text NOT NULL,
      tipo_archivo varchar(50),
      fecha_subida timestamp NOT NULL DEFAULT now(),
      subido_por integer NULL
    );
  `);

  /* =========================================================
     Índices recomendados
  ========================================================= */
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_quejas_reclamos_id_proyecto
      ON ema.quejas_reclamos (id_proyecto);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_quejas_reclamos_id_tramo
      ON ema.quejas_reclamos (id_tramo);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_quejas_reclamos_id_expediente
      ON ema.quejas_reclamos (id_expediente);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_quejas_reclamos_id_cliente
      ON ema.quejas_reclamos (id_cliente);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_quejas_reclamos_id_consultor
      ON ema.quejas_reclamos (id_consultor);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_quejas_reclamos_estado
      ON ema.quejas_reclamos (estado);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_quejas_reclamos_fecha_reclamo
      ON ema.quejas_reclamos (fecha_reclamo);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_quejas_reclamos_codigo
      ON ema.quejas_reclamos (codigo);
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_quejas_reclamos_archivos_id_queja
      ON ema.quejas_reclamos_archivos (id_queja);
  `);

  /* =========================================================
     Permisos
  ========================================================= */
  await knex.raw(`
    INSERT INTO public.permissions (code, description)
    VALUES
      ('quejas_reclamos.read',   'Ver quejas y reclamos'),
      ('quejas_reclamos.create', 'Crear quejas y reclamos'),
      ('quejas_reclamos.update', 'Editar / actualizar quejas y reclamos'),
      ('quejas_reclamos.delete', 'Eliminar quejas y reclamos')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = async function (knex) {
  /* =========================================================
     Eliminar permisos
  ========================================================= */
  await knex.raw(`
    DELETE FROM public.permissions
    WHERE code IN (
      'quejas_reclamos.read',
      'quejas_reclamos.create',
      'quejas_reclamos.update',
      'quejas_reclamos.delete'
    );
  `);

  /* =========================================================
     Eliminar índices
  ========================================================= */
  await knex.raw(`DROP INDEX IF EXISTS ema.idx_quejas_reclamos_archivos_id_queja;`);
  await knex.raw(`DROP INDEX IF EXISTS ema.idx_quejas_reclamos_codigo;`);
  await knex.raw(`DROP INDEX IF EXISTS ema.idx_quejas_reclamos_fecha_reclamo;`);
  await knex.raw(`DROP INDEX IF EXISTS ema.idx_quejas_reclamos_estado;`);
  await knex.raw(`DROP INDEX IF EXISTS ema.idx_quejas_reclamos_id_consultor;`);
  await knex.raw(`DROP INDEX IF EXISTS ema.idx_quejas_reclamos_id_cliente;`);
  await knex.raw(`DROP INDEX IF EXISTS ema.idx_quejas_reclamos_id_expediente;`);
  await knex.raw(`DROP INDEX IF EXISTS ema.idx_quejas_reclamos_id_tramo;`);
  await knex.raw(`DROP INDEX IF EXISTS ema.idx_quejas_reclamos_id_proyecto;`);

  /* =========================================================
     Eliminar tablas
  ========================================================= */
  await knex.raw(`DROP TABLE IF EXISTS ema.quejas_reclamos_archivos;`);
  await knex.raw(`DROP TABLE IF EXISTS ema.quejas_reclamos;`);
};