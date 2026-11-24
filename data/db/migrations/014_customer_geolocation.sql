-- 014_customer_geolocation.sql
-- Geolocation coordinates and zone index on erp.parties for route mapping and directory search.

ALTER TABLE erp.parties
    ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS geo_lng DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS geo_accuracy_m INTEGER,
    ADD COLUMN IF NOT EXISTS geo_updated_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_parties_geo_lat_range'
          AND conrelid = 'erp.parties'::regclass
    ) THEN
        ALTER TABLE erp.parties
            ADD CONSTRAINT chk_parties_geo_lat_range
            CHECK (geo_lat IS NULL OR (geo_lat >= -90 AND geo_lat <= 90));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_parties_geo_lng_range'
          AND conrelid = 'erp.parties'::regclass
    ) THEN
        ALTER TABLE erp.parties
            ADD CONSTRAINT chk_parties_geo_lng_range
            CHECK (geo_lng IS NULL OR (geo_lng >= -180 AND geo_lng <= 180));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_parties_geo_pair'
          AND conrelid = 'erp.parties'::regclass
    ) THEN
        ALTER TABLE erp.parties
            ADD CONSTRAINT chk_parties_geo_pair
            CHECK ((geo_lat IS NULL) = (geo_lng IS NULL));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_parties_geo_accuracy_nonneg'
          AND conrelid = 'erp.parties'::regclass
    ) THEN
        ALTER TABLE erp.parties
            ADD CONSTRAINT chk_parties_geo_accuracy_nonneg
            CHECK (geo_accuracy_m IS NULL OR geo_accuracy_m >= 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_parties_city_zone
    ON erp.parties (city_zone)
    WHERE city_zone IS NOT NULL;
