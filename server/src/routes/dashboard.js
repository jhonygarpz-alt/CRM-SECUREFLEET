import { Router } from 'express';
import { DEAL_STAGES } from '../constants.js';

export default function dashboardRoutes(db) {
  const r = Router();

  r.get('/dashboard', (req, res) => {
    const mine = req.query.mine === '1' ? req.user.id : null;
    const own = (col) => (mine ? ` AND ${col} = ${Number(mine)}` : '');

    const pipeline = DEAL_STAGES.map((stage) => {
      const row = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(value),0) AS value,
          COALESCE(SUM(value * COALESCE(probability,0) / 100.0),0) AS weighted
          FROM deals WHERE stage = ?${own('owner_id')}`).get(stage);
      return { stage, ...row };
    });

    const kpis = {
      leads_nuevos_mes: db.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE type='lead' AND wa_registered = 1
          AND created_at >= date('now','start of month')${own('owner_id')}`).get().n,
      leads_activos: db.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE type='lead' AND wa_registered = 1 AND status NOT IN ('perdido','no_calificado')${own('owner_id')}`).get().n,
      clientes: db.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE type='cliente'${own('owner_id')}`).get().n,
      pipeline_abierto: pipeline.filter((p) => !['ganado', 'perdido'].includes(p.stage)).reduce((a, p) => a + p.value, 0),
      pipeline_ponderado: pipeline.filter((p) => !['ganado', 'perdido'].includes(p.stage)).reduce((a, p) => a + p.weighted, 0),
      ganado_mes: db.prepare(`SELECT COALESCE(SUM(value),0) AS v FROM deals WHERE stage='ganado'
          AND closed_at >= date('now','start of month')${own('owner_id')}`).get().v,
      cotizaciones_abiertas: db.prepare(`SELECT COUNT(*) AS n FROM quotes WHERE status IN ('borrador','enviada')${own('created_by')}`).get().n,
      seguimientos_vencidos: db.prepare(`SELECT COUNT(*) AS n FROM activities WHERE done = 0 AND due_at IS NOT NULL
          AND due_at < strftime('%Y-%m-%dT%H:%M','now','localtime')${own('user_id')}`).get().n,
      whatsapp_sin_leer: db.prepare(`SELECT COALESCE(SUM(unread_count),0) AS n FROM contacts WHERE wa_registered = 1${own('owner_id')}`).get().n,
    };
    const closed = db.prepare(`SELECT
        SUM(CASE WHEN stage='ganado' THEN 1 ELSE 0 END) AS won, SUM(CASE WHEN stage='perdido' THEN 1 ELSE 0 END) AS lost
        FROM deals WHERE stage IN ('ganado','perdido')${own('owner_id')}`).get();
    kpis.tasa_cierre = closed.won + closed.lost > 0 ? Math.round((closed.won / (closed.won + closed.lost)) * 100) : null;

    const sources = db.prepare(`SELECT COALESCE(source,'Sin origen') AS source, COUNT(*) AS count FROM contacts
        WHERE wa_registered = 1${own('owner_id')} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`).all();

    const upcoming = db.prepare(`SELECT a.*, c.name AS contact_name, c.company AS contact_company FROM activities a
        LEFT JOIN contacts c ON c.id = a.contact_id WHERE a.done = 0 AND a.due_at IS NOT NULL${own('a.user_id')}
        ORDER BY a.due_at ASC LIMIT 10`).all();

    // Leads sin contacto en más de 3 días que siguen abiertos: candidatos a seguimiento por WhatsApp.
    const stale = db.prepare(`SELECT id, name, company, phone, status, last_contact_at, created_at FROM contacts
        WHERE type='lead' AND wa_registered = 1 AND status IN ('nuevo','contactado','calificado')
        AND COALESCE(last_contact_at, created_at) < datetime('now','-3 days')${own('owner_id')}
        ORDER BY COALESCE(last_contact_at, created_at) ASC LIMIT 10`).all();

    const monthly = db.prepare(`SELECT strftime('%Y-%m', closed_at) AS month, COALESCE(SUM(value),0) AS value, COUNT(*) AS count
        FROM deals WHERE stage='ganado' AND closed_at >= date('now','start of month','-5 months')${own('owner_id')}
        GROUP BY 1 ORDER BY 1`).all();

    res.json({ kpis, pipeline, sources, upcoming, stale, monthly });
  });

  return r;
}
