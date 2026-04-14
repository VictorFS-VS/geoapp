const fs = require('fs');
const path = 'c:\\geoapp\\geoapp\\backend\\services\\projectHome\\projectHomeInformes.service.js';
let content = fs.readFileSync(path, 'utf8');

const regex = /const autoSelected = selectProjectHomeKpis\(focusRaw\.field_summaries \|\| \[\]\);\n\s*const resolvedKpisItem = resolveProjectHomeKpiOverridesFromSummaries\(\n\s*item,\s*\n\s*focusRaw\.field_summaries \|\| \[jK\s\]*\[\]\,\s*\n\s*autoSelected\n\s*\);\n*\s*return \{([\s\S]*?)\n\s*\secondary:\s*resolvedKpisItem\.secondary\n\s*\};\n\s*\}\)\);/m;

// Since regex is tricky with multi-line, I will use string replace directly with a known block.

const blockToFind = `    const autoSelected = selectProjectHomeKpis(focusRaw.field_summaries || []);
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
    };`;

const blockToReplace = `    const autoSelected = selectProjectHomeKpis(focusRaw.field_summaries || []);
    const resolvedKpisItem = resolveProjectHomeKpiOverridesFromSummaries(
      item, 
      focusRaw.field_summaries || [], 
      autoSelected
    );

    const baseTotal = Number(focusRaw?.general?.total_informes) || 0;
    
    // Process Primary
    let primary_val = baseTotal;
    let primary_label = "Registros totales";
    let primary_context = "Sin KPI configurado";
    
    if (resolvedKpisItem.primary && Array.isArray(resolvedKpisItem.primary.items) && resolvedKpisItem.primary.items.length > 0) {
      const itemsCopy = [...resolvedKpisItem.primary.items].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
      const top1 = itemsCopy[0];
      const topCount = Number(top1.count) || 0;
      
      let localBase = 0;
      for (const t of itemsCopy) localBase += (Number(t.count) || 0);
      
      primary_val = topCount;
      primary_label = String(top1.label || "Indefinido");
      
      const pct = localBase > 0 ? Math.round((topCount / localBase) * 100) : 0;
      primary_context = \`Predomina en \${resolvedKpisItem.primary.etiqueta} (\${pct}%)\`;
    }

    // Process Secondary
    const secondary_lines = [];
    if (Array.isArray(resolvedKpisItem.secondary)) {
      for (const sec of resolvedKpisItem.secondary) {
        if (!sec || !Array.isArray(sec.items) || sec.items.length === 0) continue;
        const itemsCopy = [...sec.items].sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
        const top1 = itemsCopy[0];
        secondary_lines.push({
          label: sec.etiqueta || "Secundario",
          val: Number(top1.count) || 0,
          meta: \`Predomina: \${top1.label || "Indefinido"}\`
        });
        if (secondary_lines.length >= 2) break;
      }
    }

    return {
      key: item.id_home_item === 'legacy-base' ? 'legacy' : String(item.id_home_item),
      source_kind: item.source_kind || 'item',
      id_home_item: item.id_home_item === 'legacy-base' ? null : Number(item.id_home_item),
      id_plantilla: Number(item.id_plantilla),
      label: item.label || item.plantilla_nombre || \`Reporte \${item.id_plantilla}\`,
      primary_val,
      primary_label,
      primary_context,
      secondary_lines
    };`;

if(content.includes(blockToFind)) {
  content = content.replace(blockToFind, blockToReplace);
  fs.writeFileSync(path, content, 'utf8');
  console.log("Success backend replace");
} else {
  console.log("Block not found");
}
