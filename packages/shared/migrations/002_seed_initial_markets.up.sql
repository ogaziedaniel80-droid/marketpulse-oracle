-- Seed Launch Markets (Nigeria pilot per README sections 1, 9, 25)

INSERT INTO markets (id, name, city, country_code, geohash, location, metadata)
VALUES
    (
        'ng-lagos-mile12',
        'Mile 12 Market',
        'Lagos',
        'NG',
        's14b3k9x',
        ST_SetSRID(ST_MakePoint(3.3934, 6.6111), 4326)::geography,
        '{"category": "wholesale_food", "primary_staples": ["RICE50", "TOMATO", "GARRI"]}'::jsonb
    ),
    (
        'ng-abuja-wuse',
        'Wuse Market',
        'Abuja',
        'NG',
        's1rc1m98',
        ST_SetSRID(ST_MakePoint(7.4643, 9.0645), 4326)::geography,
        '{"category": "retail_food", "primary_staples": ["RICE50", "MAIZE", "TOMATO"]}'::jsonb
    ),
    (
        'ng-ibadan-bodija',
        'Bodija Market',
        'Ibadan',
        'NG',
        's11f4r12',
        ST_SetSRID(ST_MakePoint(3.9067, 7.4332), 4326)::geography,
        '{"category": "wholesale_produce", "primary_staples": ["TOMATO", "GARRI", "MAIZE"]}'::jsonb
    ),
    (
        'ng-kano-dawanau',
        'Dawanau Grain Market',
        'Kano',
        'NG',
        's1t4z801',
        ST_SetSRID(ST_MakePoint(8.4419, 12.0831), 4326)::geography,
        '{"category": "grain_hub", "primary_staples": ["RICE50", "MAIZE", "GARRI"]}'::jsonb
    )
ON CONFLICT (id) DO NOTHING;
