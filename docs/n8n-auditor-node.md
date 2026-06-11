# Nodo LLM auditor (opcional) — especificación para n8n

La app **ya consume** un objeto opcional `audit` por documento en la respuesta del
webhook de extracción. Si el workflow no lo envía, nada cambia (contrato 100%
retrocompatible). Este documento especifica cómo agregar el nodo en n8n cuando
se quiera la segunda capa de auditoría.

> Importante: el auditor **no genera una nueva cotización ni sobreescribe
> datos**. La app (validador final, `auditQuoteEconomics.ts`) solo usa sus
> salidas para cruzar valores, completar el folio si falta y marcar
> `needsReview`. Un valor del auditor jamás reemplaza una línea extraída.

## Cuándo ejecutarlo (condición del nodo IF previo)

Ejecutar el auditor solo si se cumple al menos una:

1. `abs(suma(items[].total) - quoteSubtotal) > max(2, 1% de quoteSubtotal)`
   (diferencia entre suma de ítems y subtotal del documento);
2. el texto del PDF contiene `descuento|dscto|dcto` cerca de un monto;
3. alguna línea contiene medidas que podrían confundirse con precios
   (`\d+\s*(cm|mm|mts?|kg|pulg|")` o patrones `210x60x19`);
4. el extractor entregó ítems sin `rawLine` o sin precio con fuente clara;
5. el extractor o la validación marcaron warnings de riesgo / `needsReview`.

## Entrada del nodo (prompt de usuario)

```json
{
  "pdfText": "<texto plano completo del PDF>",
  "extractedJson": { "...": "JSON del documento tal como salió del extractor" },
  "warnings": ["..."],
  "valuesUsed": {
    "itemsNetSum": 123456,
    "currency": "CLP",
    "quoteSubtotal": 123456,
    "quoteTotal": 146912,
    "documentNumber": "423"
  }
}
```

## System prompt sugerido

```
Eres un auditor de cotizaciones de compras. NO extraes una cotización nueva:
solo verificas la ya extraída contra el texto del PDF.

Reglas:
- La base de adjudicación es SIEMPRE el NETO SIN IVA (subtotal neto). Nunca el
  total con IVA.
- Verifica si la suma de líneas coincide con el subtotal neto del documento.
- Detecta descuentos (globales o por línea) y su monto exacto según el PDF.
- Detecta números que son medidas/dimensiones/códigos (210 cm, 19 mm, 210x60x19,
  modelos, P/N) y que el extractor pudo usar como precios.
- Identifica el número de cotización/folio del documento.
- Si no hay evidencia textual suficiente para confirmar un valor, NO lo
  confirmes: repórtalo en suspiciousValues o notes.

Responde SOLO este JSON, sin texto adicional:
{
  "auditStatus": "approved" | "needs_review" | "reject",
  "suspiciousValues": ["descripcion corta de cada valor dudoso"],
  "confirmedNetSubtotal": number | null,
  "confirmedDiscount": number | null,
  "confirmedQuotationNumber": "string | null",
  "notes": ["observaciones breves"]
}
```

## Dónde conectar la salida

Adjuntar el JSON del auditor al documento correspondiente en la respuesta del
webhook, campo `audit` (mismo nivel que `items`):

```json
{
  "documents": [
    {
      "fileName": "cotizacion-vasquez.pdf",
      "items": [ ... ],
      "audit": {
        "auditStatus": "needs_review",
        "suspiciousValues": ["unitPrice 210 coincide con '210 cm' de la descripción"],
        "confirmedNetSubtotal": 558900,
        "confirmedDiscount": 62100,
        "confirmedQuotationNumber": "7788",
        "notes": ["el documento aplica DESCUENTO ESPECIAL antes del subtotal"]
      }
    }
  ]
}
```

**No** modificar el nodo "Validate & Build Response" existente ni el prompt del
LLM extractor: el auditor es un nodo paralelo posterior cuya salida solo se
anexa al documento.

## Qué hace la app con cada campo

| Campo | Uso en la app |
|---|---|
| `auditStatus` = `needs_review` / `reject` | warning `[RIESGOS]` + `needsReview: true` (la cotización se conserva si tiene datos suficientes) |
| `suspiciousValues` | warnings `[RIESGOS]` (máx. 5) + `needsReview` |
| `confirmedNetSubtotal` | solo cruce: si difiere >1% de la suma de líneas usada, warning + `needsReview`. Nunca reemplaza la suma. |
| `confirmedDiscount` | solo trazabilidad: se informa y se cruza contra los descuentos detectados; no se aplica a ciegas |
| `confirmedQuotationNumber` | se usa únicamente si el extractor NO entregó folio (con warning de trazabilidad) |
| `notes` | warnings `[TRAZABILIDAD]` (máx. 3) |
