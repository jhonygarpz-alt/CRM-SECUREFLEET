# SecureFleet CRM

CRM propio de **SecureFleet** para administrar leads y clientes, llevar el pipeline de ventas, generar cotizaciones en PDF, mantener el catálogo de productos y servicios, y **dar seguimiento a los clientes por WhatsApp Business** desde el mismo sistema.

## Módulos

| Módulo | Qué hace |
|---|---|
| **Tablero** | KPIs (pipeline abierto y ponderado, ventas ganadas del mes, tasa de cierre, WhatsApp sin leer, seguimientos vencidos), embudo por etapa, próximos seguimientos, leads sin contacto en más de 3 días, origen de leads y ventas por mes. Filtro "Solo míos". |
| **Leads y clientes** | Alta, edición, búsqueda y filtros (estatus, origen, tipo). Tamaño de flotilla, asesor asignado, etiquetas, consentimiento de WhatsApp. Importación masiva desde CSV. La ficha muestra chat de WhatsApp, seguimientos, oportunidades y cotizaciones. |
| **Pipeline de ventas** | Kanban con arrastrar y soltar: Prospecto → Contactado → Demo → Propuesta → Negociación → Ganado / Perdido. La probabilidad se ajusta sola por etapa. Al ganar, el lead pasa a cliente. |
| **WhatsApp** | Bandeja tipo WhatsApp Web: conversaciones, mensajes no leídos, estados (enviado / entregado / leído), respuestas rápidas (`/demo`, `/seguimiento`…), plantillas aprobadas para escribir fuera de la ventana de 24 h. Un número nuevo que escribe se registra como lead automáticamente, con mensaje de bienvenida opcional. |
| **Seguimientos** | Tareas, llamadas, demos y recordatorios de WhatsApp con fecha, y filtros para vencidos, hoy, pendientes y completados. Se pueden posponer (+1 día / +1 semana) o abrir el chat directamente. |
| **Cotizaciones** | Folio automático (`SF-COT-2026-0001`), partidas del catálogo o libres, descuento por partida, IVA del 16 %, 8 % o 0 %, cobros únicos, mensuales o anuales, vigencia, PDF con tu marca y **envío del PDF por WhatsApp** en un clic. Si se acepta una cotización, la oportunidad se marca como ganada. |
| **Catálogo** | Productos y servicios (GPS, dashcams, sensores, instalación, plataforma mensual o anual, monitoreo 24/7) con SKU, categoría, precio, costo y margen, periodicidad e IVA. |
| **Configuración** | Datos fiscales de la empresa para el PDF, términos por defecto, prefijo de folio, automatizaciones de WhatsApp, respuestas rápidas, usuarios del equipo (admin / ventas) y cambio de contraseña. |

## Stack

- **Backend:** Node.js 20+ con Express, SQLite (`better-sqlite3`), autenticación JWT y PDFKit para las cotizaciones.
- **Frontend:** React 18 con Vite y React Router.
- **WhatsApp:** API oficial de Meta, [WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).

```
server/   API REST, webhooks de WhatsApp, PDF, base de datos
client/   Aplicación web (React)
```

## Instalación en tu computadora (Windows / Mac)

Requisitos: [Node.js 22 LTS](https://nodejs.org) y [Git](https://git-scm.com).

```bash
git clone https://github.com/jhonygarpz-alt/CRM-SECUREFLEET.git
cd CRM-SECUREFLEET
git checkout claude/securefleet-crm-whatsapp-lipfmm
npm run setup     # instala dependencias, carga datos de ejemplo y compila la web (solo la primera vez)
npm start         # abre http://localhost:4000
```

## Arranque rápido (desarrollo)

```bash
npm run install:all
cp server/.env.example server/.env      # edita JWT_SECRET y, cuando las tengas, las llaves de WhatsApp
npm run seed                             # catálogo base, leads de ejemplo y respuestas rápidas
npm run dev:server                       # API en http://localhost:4000
npm run dev:client                       # web en http://localhost:5173
```

Usuario inicial: `admin@securefleet.mx` / `admin123`. **Cámbialo** desde Configuración o con `ADMIN_EMAIL` y `ADMIN_PASSWORD` antes del primer arranque.

> Los precios del catálogo de ejemplo son ilustrativos. Ajústalos en **Catálogo**.

Sin credenciales de WhatsApp, el CRM trabaja en **modo simulación**: los mensajes se guardan pero no se envían. En la bandeja de WhatsApp, el botón 🧪 simula un mensaje entrante para probar el flujo completo.

## Producción

```bash
npm run build     # compila el frontend a client/dist
npm start         # el servidor sirve la API y la web en el mismo puerto
```

O con Docker:

```bash
docker build -t securefleet-crm .
docker run -d -p 4000:4000 -v crm-data:/data --env-file server/.env securefleet-crm
```

Para que Meta pueda enviar los webhooks, el servidor necesita una URL pública con **HTTPS**, por ejemplo Railway, Render, un VPS con Nginx y Let's Encrypt, o `ngrok` para pruebas.

## Conectar WhatsApp Business (Cloud API)

1. En [Meta for Developers](https://developers.facebook.com/apps) crea una app de tipo **Business** y agrega el producto **WhatsApp**.
2. Registra el número de SecureFleet. Si ese número ya se usa en la app de WhatsApp Business del celular, hay que migrarlo o usar la función de *coexistencia* si tu cuenta la tiene disponible. Copia el **Phone Number ID** y el **WhatsApp Business Account ID**.
3. En Business Manager crea un **usuario del sistema**, asígnale la app y la cuenta de WhatsApp, y genera un **token permanente** con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Llena `server/.env`:
   ```
   WHATSAPP_TOKEN=EAAG...
   WHATSAPP_PHONE_NUMBER_ID=1234567890
   WHATSAPP_BUSINESS_ACCOUNT_ID=9876543210
   WHATSAPP_VERIFY_TOKEN=un-texto-secreto-que-tu-eliges
   WHATSAPP_APP_SECRET=secreto-de-la-app   # Configuración de la app → Básica
   ```
5. En **WhatsApp → Configuración → Webhook**:
   - URL de devolución de llamada: `https://TU-DOMINIO/api/whatsapp/webhook`
   - Token de verificación: el mismo valor de `WHATSAPP_VERIFY_TOKEN`
   - Suscríbete al campo **messages**, que incluye los mensajes entrantes y los estados de entrega y lectura.
6. En WhatsApp Manager crea **plantillas** (por ejemplo `seguimiento_cotizacion`: *"Hola {{1}}, ¿pudiste revisar la cotización {{2}}?"*). Cuando Meta las apruebe aparecerán en el chat del CRM.

### Reglas de WhatsApp que respeta el CRM

- **Ventana de 24 horas:** solo se pueden mandar mensajes libres y documentos (como el PDF de la cotización) si el cliente escribió en las últimas 24 h. Fuera de esa ventana, el CRM pide una **plantilla aprobada**.
- **Consentimiento:** los contactos marcados sin *opt-in* no reciben mensajes.
- Los webhooks se validan con la firma `X-Hub-Signature-256` cuando está configurado `WHATSAPP_APP_SECRET`, y los mensajes duplicados que Meta reintenta se ignoran.

## API (resumen)

Todas las rutas van bajo `/api` y requieren `Authorization: Bearer <token>`, salvo el login y el webhook.

| Recurso | Rutas |
|---|---|
| Autenticación | `POST /auth/login`, `GET /auth/me`, `POST /auth/password` |
| Usuarios | `GET/POST /users`, `PUT /users/:id` |
| Contactos | `GET/POST /contacts`, `GET/PUT/DELETE /contacts/:id`, `POST /contacts/import` |
| Oportunidades | `GET/POST /deals`, `GET/PUT/DELETE /deals/:id` |
| Catálogo | `GET/POST /products`, `GET/PUT/DELETE /products/:id` |
| Cotizaciones | `GET/POST /quotes`, `GET/PUT/DELETE /quotes/:id`, `GET /quotes/:id/pdf`, `POST /quotes/:id/send-whatsapp`, `POST /quotes/:id/duplicate` |
| Actividades | `GET/POST /activities` (`?filter=vencidas\|hoy\|pendientes\|completadas`), `PUT/DELETE /activities/:id` |
| WhatsApp | `GET/POST /whatsapp/webhook`, `GET /whatsapp/status`, `GET /whatsapp/conversations`, `GET /whatsapp/conversations/:contactId`, `POST .../send`, `POST .../template`, `POST .../read`, `GET /whatsapp/templates`, `GET/POST/DELETE /whatsapp/quick-replies` |
| Tablero y configuración | `GET /dashboard`, `GET/PUT /settings` |

## Pruebas

```bash
npm test
```

Las pruebas de integración cubren el flujo completo: un lead llega por WhatsApp, recibe respuesta, se actualizan los estados de entrega, se crea la cotización con su PDF, se envía por WhatsApp y al aceptarla la oportunidad pasa a ganada. También verifican la firma del webhook, la ventana de 24 h con plantillas y los teléfonos duplicados.
