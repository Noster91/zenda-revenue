-- ============================================================
-- Zenda Dashboard — Cierre de Períodos
-- Correr en Supabase → SQL Editor
-- ============================================================

-- 1. Tabla maestra de períodos (ene-26 … dic-26)
CREATE TABLE IF NOT EXISTS periodos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo       TEXT UNIQUE NOT NULL,        -- 'ene-26'
  mes_num      SMALLINT NOT NULL CHECK (mes_num BETWEEN 1 AND 12),
  año          SMALLINT NOT NULL,
  label        TEXT NOT NULL,               -- 'Enero 2026'
  estado       TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  fecha_cierre TIMESTAMPTZ,
  closed_by    UUID REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Snapshot completo de un mes cerrado
CREATE TABLE IF NOT EXISTS period_closes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id     UUID UNIQUE REFERENCES periodos(id) ON DELETE CASCADE,
  pod_design     JSONB NOT NULL DEFAULT '{}',   -- pods + assignments + clientAssignments
  team_costs     JSONB NOT NULL DEFAULT '{}',   -- { nombre: costoARS }
  revenue        JSONB NOT NULL DEFAULT '{}',   -- { cliente: revenueUSD }
  overhead_usd   NUMERIC NOT NULL DEFAULT 0,
  estructura_usd NUMERIC NOT NULL DEFAULT 0,
  rate           NUMERIC NOT NULL DEFAULT 0,    -- TC dólar blue al cierre
  metrics        JSONB NOT NULL DEFAULT '{}',   -- podMetrics[] + globalMetrics
  closed_by      UUID REFERENCES auth.users(id),
  closed_at      TIMESTAMPTZ DEFAULT NOW(),
  reopened_at    TIMESTAMPTZ,
  reopened_by    UUID REFERENCES auth.users(id)
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_periodos_codigo  ON periodos(codigo);
CREATE INDEX IF NOT EXISTS idx_periodos_estado  ON periodos(estado);
CREATE INDEX IF NOT EXISTS idx_period_closes_periodo ON period_closes(periodo_id);

-- 4. RLS
ALTER TABLE periodos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_closes ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all periods
CREATE POLICY "periodos_read"  ON periodos      FOR SELECT TO authenticated USING (true);
CREATE POLICY "closes_read"    ON period_closes FOR SELECT TO authenticated USING (true);

-- Only authenticated users can write
CREATE POLICY "periodos_write" ON periodos      FOR ALL    TO authenticated USING (true);
CREATE POLICY "closes_write"   ON period_closes FOR ALL    TO authenticated USING (true);

-- 5. Seed: 12 períodos 2026
INSERT INTO periodos (codigo, mes_num, año, label) VALUES
  ('ene-26',  1, 2026, 'Enero 2026'),
  ('feb-26',  2, 2026, 'Febrero 2026'),
  ('mar-26',  3, 2026, 'Marzo 2026'),
  ('abr-26',  4, 2026, 'Abril 2026'),
  ('may-26',  5, 2026, 'Mayo 2026'),
  ('jun-26',  6, 2026, 'Junio 2026'),
  ('jul-26',  7, 2026, 'Julio 2026'),
  ('ago-26',  8, 2026, 'Agosto 2026'),
  ('sept-26', 9, 2026, 'Septiembre 2026'),
  ('oct-26', 10, 2026, 'Octubre 2026'),
  ('nov-26', 11, 2026, 'Noviembre 2026'),
  ('dic-26', 12, 2026, 'Diciembre 2026')
ON CONFLICT (codigo) DO NOTHING;
