# Tabla comparativa de cotizaciones

Aplicación Next.js para generar una tabla comparativa Excel desde PDFs de cotizaciones de proveedores, usando la plantilla oficial `templates/template.xlsx`.

La app no crea un Excel desde cero: abre la plantilla `.xlsx`, limpia solo campos dinámicos definidos en `src/lib/excel/templateMap.ts`, escribe los nuevos datos y conserva diseño, estilos, bordes, celdas combinadas, fórmulas, encabezados y secciones inferiores.

## Instalación local

```bash
npm install
npx prisma migrate dev
npm run dev
```

La app queda disponible en:

```text
http://localhost:3000
```

## Variables de entorno

Copia el archivo de ejemplo:

```bash
cp .env.example .env
```

Valores para desarrollo local:

```text
DATABASE_URL="file:../data/dev.db"
STORAGE_DIR=
TARGET_CURRENCY=CLP
EXCHANGE_RATE_CLP_PER_USD=
FALLBACK_EXCHANGE_RATE_CLP_PER_USD=950
EXCHANGE_RATE_MARGIN_CLP=5
```

Si `STORAGE_DIR` está vacío, la app usa las rutas locales del repositorio:

```text
data/
uploads/
output/
templates/template.xlsx
```

Si `STORAGE_DIR` existe, la app usa almacenamiento persistente fuera del repositorio:

```text
${STORAGE_DIR}/data
${STORAGE_DIR}/uploads
${STORAGE_DIR}/output
${STORAGE_DIR}/templates/template.xlsx
```

Al iniciar un procesamiento, la app ejecuta `ensureStorageLayout()`: crea las carpetas necesarias y, si `templates/template.xlsx` existe en el repositorio pero no existe en `${STORAGE_DIR}/templates/template.xlsx`, copia la plantilla al storage. No sobrescribe una plantilla existente en el storage.

Notas de moneda:

- `TARGET_CURRENCY=CLP` deja toda la comparación final en pesos chilenos.
- `EXCHANGE_RATE_CLP_PER_USD` vacío activa modo automático usando `https://mindicador.cl/api/dolar`.
- El valor manual ingresado en la pantalla tiene prioridad sobre cualquier variable de entorno.
- Si falla la API, `EXCHANGE_RATE_CLP_PER_USD` puede usarse como override de entorno; si no existe, se usa `FALLBACK_EXCHANGE_RATE_CLP_PER_USD`.
- `EXCHANGE_RATE_MARGIN_CLP=5` suma 5 CLP al tipo de cambio base antes de convertir USD a CLP.

## Producción

Comandos base para construir y ejecutar:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
npm run start
```

También puedes usar:

```bash
npm run prisma:deploy
```

## Oracle Cloud Free Tier

1. Crea una VM Always Free en Oracle Cloud.
2. Instala Node.js LTS, Git y PM2.
3. Clona el repositorio desde GitHub.
4. Crea el directorio persistente:

```bash
sudo mkdir -p /opt/embudo-storage/data /opt/embudo-storage/uploads /opt/embudo-storage/output /opt/embudo-storage/templates
sudo chown -R $USER:$USER /opt/embudo-storage
```

5. Crea `.env` en la raíz del proyecto:

```text
STORAGE_DIR=/opt/embudo-storage
DATABASE_URL=file:/opt/embudo-storage/data/dev.db
TARGET_CURRENCY=CLP
EXCHANGE_RATE_CLP_PER_USD=
FALLBACK_EXCHANGE_RATE_CLP_PER_USD=950
EXCHANGE_RATE_MARGIN_CLP=5
```

6. Instala, genera Prisma, aplica migraciones y compila:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
```

7. Inicia con PM2:

```bash
pm2 start npm --name embudo -- start
pm2 save
pm2 startup
```

Con esa configuración:

- SQLite queda en `/opt/embudo-storage/data/dev.db`.
- Los uploads quedan en `/opt/embudo-storage/uploads`.
- Los Excel generados quedan en `/opt/embudo-storage/output`.
- La plantilla se busca en `/opt/embudo-storage/templates/template.xlsx`.

## Railway, Render o Azure App Service

Configura las mismas variables de entorno según el disco persistente que ofrezca la plataforma:

```text
STORAGE_DIR=<ruta-del-disco-persistente>
DATABASE_URL=file:<ruta-del-disco-persistente>/data/dev.db
TARGET_CURRENCY=CLP
EXCHANGE_RATE_CLP_PER_USD=
FALLBACK_EXCHANGE_RATE_CLP_PER_USD=950
EXCHANGE_RATE_MARGIN_CLP=5
```

Para Railway con volumen persistente en `/data`, usa:

```text
DATABASE_URL=file:/data/data/dev.db
STORAGE_DIR=/data
TARGET_CURRENCY=CLP
EXCHANGE_RATE_CLP_PER_USD=
FALLBACK_EXCHANGE_RATE_CLP_PER_USD=950
EXCHANGE_RATE_MARGIN_CLP=5
NODE_ENV=production
```

Si Railway no permite crear `EXCHANGE_RATE_CLP_PER_USD` vacÃ­o, no crees esa variable.

Usa estos comandos de despliegue:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
```

Y como comando de inicio:

```bash
npm run start
```

## Uso

1. Abre `http://localhost:3000`.
2. Sube una o varias cotizaciones PDF.
3. Presiona `Generar tabla comparativa`.
4. Revisa proveedores detectados, productos detectados y advertencias.
5. Descarga el Excel final con `Descargar Excel generado`.

## Flujo

1. `POST /api/process` recibe `multipart/form-data`.
2. Ejecuta `ensureStorageLayout()`.
3. Valida la plantilla `.xlsx` y los PDFs.
4. Crea un `ProcessingJob`.
5. Guarda archivos en `uploads/{jobId}` o `${STORAGE_DIR}/uploads/{jobId}`.
6. Extrae texto de cada PDF con `pdf-parse`.
7. Detecta proveedor y parsea productos.
8. Valida el JSON normalizado con Zod.
9. Guarda resultados en SQLite con Prisma.
10. Consolida productos equivalentes de forma conservadora.
11. Abre la plantilla con ExcelJS.
12. Ejecuta `clearTemplateDynamicFields()`.
13. Rellena productos, proveedores y ofertas.
14. Guarda `output/{jobId}/tabla-comparativa.xlsx` o `${STORAGE_DIR}/output/{jobId}/tabla-comparativa.xlsx`.
15. `GET /api/download/{jobId}` entrega el archivo.

## Plantilla Excel

Coordenadas reales inspeccionadas:

- Hoja: `TABLA COMPARATIVA`
- Productos: filas `8` a `27`
- Columnas base: `A` ITEM, `B` PRODUCTO, `C` CANT, `D` UM
- Proveedores: `E:F`, `G:H`, `I:J`, `K:L`, `M:N`, `O:P`
- TOTAL: fila `28`
- COMPRA: fila `29`
- PROVEEDOR MD (CON CRÉDITO): fila `31`
- CONDICIÓN DE PAGO: fila `32`
- PLAZO DE ENTREGA: fila `33`

La limpieza está centralizada en:

```text
src/lib/excel/clearTemplateDynamicFields.ts
```

Y solo usa coordenadas desde:

```text
src/lib/excel/templateMap.ts
```

## Limitaciones actuales

- Parsers de ADIS, Tecno Mercado y Echave Turri son iniciales y conservadores.
- El parser genérico puede requerir ajustes por formato de PDF.
- Si no se detecta moneda, marca `UNKNOWN` y agrega advertencia.
- Si la similitud de productos no es clara, no fusiona automáticamente.
- La plantilla actual permite 20 productos y 6 proveedores; lo extra genera advertencias.

## Windows

En Windows, si la consola queda en modo selección (QuickEdit), Node puede pausarse mientras procesa.
Evita dejar texto seleccionado dentro de CMD/PowerShell durante el proceso. Si ocurre, presiona `Esc` o `Enter`.
