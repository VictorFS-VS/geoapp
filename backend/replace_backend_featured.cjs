const fs = require('fs');

const path = 'c:\\geoapp\\geoapp\\backend\\services\\projectHome\\projectHomeInformes.service.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Agregar require de getItemByProject
content = content.replace(
  /const { getProjectHomeQuejasResumen } = require\("\.\/projectHomeQuejas\.service"\);/,
  `$&
const { getItemsByProject } = require("./projectHomeItem.service");`
);

// 2. Insertar lógica de featured_reports antes del return
content = content.replace(
  /const lightweightPeriodTotal = Number\(kpis\.total_informes\) \|\| 0;/,
  `$&

  const featuredRaw = await getItemsByProject({ req, id_proyecto, include_legacy: true });
  const featured = featuredRaw.slice(0, 4);
  const featured_reports = await Promise.all(featured.map(async (item) => {
    let focusRaw = rawForKpisBase;
    if (Number(item.id_plantilla) !== Number(focusPlantillaId)) {
      focusRaw = await getInformesResumenRaw({
        req,
        id_proyecto,
        id_plantilla: item.id_plantilla,
        skip_temporal: true,
      });
    }

    const autoSelected = selectProjectHomeKpis(focusRaw.field_summaries || []);
    const resolvedKpisItem = resolveProjectHomeKpiOverridesFromSummaries(
      item, 
      focusRaw.field_summaries || [], 
      autoSelected
    );

    return {
      key: item.id_home_item === 'legacy-base' ? 'legacy' : String(item.id_home_item),
      source_kind: item.source_kind || 'item',
      id_home_item: item.id_home_item === 'legacy-base' ? null : Number(item.id_home_item),
      id_plantilla: Number(item.id_plantilla),
      label: item.label || item.plantilla_nombre || \`Reporte \${item.id_plantilla}\`,
      primary: resolvedKpisItem.primary,
      secondary: resolvedKpisItem.secondary
    };
  }));`
);

// 3. Añadir a la respuesta JSON
content = content.replace(
  /quejas,/,
  `$&
    featured_reports,`
);

fs.writeFileSync(path, content, 'utf8');
console.log('Patched featured array');
