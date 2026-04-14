const fs = require('fs');
const path = 'c:\\geoapp\\geoapp\\backend\\services\\projectHome\\projectHomeInformes.service.js';
let content = fs.readFileSync(path, 'utf8');

// 1. Reemplazar require
content = content.replace(
  /const { getProjectHomeExpedientesResumen }([^\n]+)/,
  `const { getProjectHomeExpedientesResumen }$1\nconst { getProjectHomeQuejasResumen } = require("./projectHomeQuejas.service");`
);

// 2. Reemplazar llamada de expedientes
content = content.replace(
  /const expedientes = await getProjectHomeExpedientesResumen\([^)]+\);/,
  `$&
  const quejas = await getProjectHomeQuejasResumen({ req, id_proyecto });`
);

// 3. Reemplazar el payload return
content = content.replace(
  /expedientes,\s*field_summaries:/,
  `expedientes,
    quejas,
    field_summaries:`
);

fs.writeFileSync(path, content, 'utf8');
console.log('Backend patched.');
