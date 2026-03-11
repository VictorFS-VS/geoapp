# Control de Acceso a Plantillas de Informes

## Cambios Realizados

Se ha implementado un sistema de control de acceso para las plantillas de informes con los siguientes campos:

### 1. Nuevos Campos en `ema.informe_plantilla`

- **`id_creador`** (integer): ID del usuario que creó la plantilla
- **`proyectos_permitidos`** (JSONB): Array de `gid` de proyectos permitidos
  - Si es `NULL` → la plantilla es accesible en todos los proyectos
  - Si es un array → solo accesible en esos proyectos
- **`usuarios_compartidos`** (JSONB): Array de user IDs con los que se comparte
  - Si es `NULL` → accesible para todos
  - Si es un array → solo accesible para esos usuarios o el creador
- **`activo`** (boolean): Ya existía. Si es false, nadie puede ver la plantilla

### 2. Reglas de Acceso

Una plantilla es **visible** si:
1. `activo = true` Y
2. (El usuario es el creador) O (El usuario está en `usuarios_compartidos`) O (`usuarios_compartidos` es NULL) Y
3. (Todos los proyectos) O (El proyecto actual está en `proyectos_permitidos`)

### 3. Endpoints Modificados

#### GET `/api/informes/plantillas` (Nuevo filtrado)
```javascript
// Ahora solo devuelve plantillas activas y accesibles para el usuario actual
// Filtro automático basado en:
// - id_creador = usuario actual
// - usuarios_compartidos contiene el usuario actual
// - usuarios_compartidos es NULL (accesible para todos)
```

#### GET `/api/informes/proyecto/:idProyecto/por-plantilla` (Nuevo filtrado)
```javascript
// Ahora filtra por:
// - proyectos_permitidos es NULL o contiene el proyecto actual
// - El usuario tiene acceso (mismo filtro que arriba)
// - activo = true
```

#### POST `/api/informes/plantillas` (Nuevo)
```javascript
// Body:
{
  "nombre": "Mi Plantilla",
  "descripcion": "Descripción",
  "activo": true,
  "proyectos_permitidos": [1, 2, 3],  // Optional: null = todos
  "usuarios_compartidos": [5, 10]      // Optional: null = todos
}
// Automáticamente asigna id_creador = usuario actual
```

#### PUT `/api/informes/plantillas/:id` (Modificado)
```javascript
// Solo el creador puede editar
// Body (todos los campos son opcionales):
{
  "nombre": "Nuevo nombre",
  "descripcion": "Nueva descripción",
  "activo": false,
  "proyectos_permitidos": [1, 5],
  "usuarios_compartidos": [7, 8, 9]
}
```

### 4. Ejemplo de Uso

#### Crear una plantilla privada solo para proyectos 1 y 2
```javascript
POST /api/informes/plantillas
{
  "nombre": "Encuesta Privada",
  "descripcion": "Solo para proyectos específicos",
  "activo": true,
  "proyectos_permitidos": [1, 2],
  "usuarios_compartidos": null  // Solo el creador la ve
}
```

#### Crear una plantilla compartida con usuarios específicos
```javascript
POST /api/informes/plantillas
{
  "nombre": "Plantilla Compartida",
  "descripcion": "Para usuarios específicos",
  "activo": true,
  "proyectos_permitidos": null,  // Todos los proyectos
  "usuarios_compartidos": [5, 10, 15]  // + el creador automáticamente
}
```

#### Desactivar una plantilla sin eliminarla
```javascript
PUT /api/informes/plantillas/123
{
  "activo": false
}
```

## Pasos para Aplicar

1. **Ejecutar la migración:**
   ```bash
   npm run migrate
   ```

2. **Reiniciar el backend:**
   ```bash
   npm start
   ```

3. **Verificar en base de datos:**
   ```sql
   SELECT id_plantilla, nombre, id_creador, activo, 
          proyectos_permitidos, usuarios_compartidos
   FROM ema.informe_plantilla;
   ```

## Consideraciones

- El campo `id_creador` se asigna automáticamente en POST
- Solo el creador puede editar/desactivar una plantilla
- Las plantillas desactivadas nunca aparecen en las listados
- El valor `NULL` en `proyectos_permitidos` o `usuarios_compartidos` significa "sin restricción"
- Los arrays se usan operadores JSONB de PostgreSQL (`@>` para contiene)
