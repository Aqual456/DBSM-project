-- ReliefFlow standard reference data. Safe to re-run (every INSERT is ON CONFLICT DO NOTHING).
-- Contains only reference data a real deployment needs: the four roles, a placeholder
-- administrator (its hash is unusable; set a password with npm run db:admin), and a relief-item
-- catalogue whose units and planning figures follow the Sphere Handbook (2018) minimum standards.
-- Scenario data (disasters, camps, stock, requests ...) is loaded separately by npm run db:seed.

INSERT INTO roles(role_name, description) VALUES
('ADMIN', 'System administrator: users, roles and all data'),
('RELIEF_COORDINATOR', 'Coordinates the response: approvals, allocations, deliveries'),
('FIELD_OFFICER', 'Works at camps: raises requests, admits people, reports incidents'),
('DRIVER', 'Transports allocated relief supplies and reports delivery progress')
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO app_users(role_id, full_name, email, password_hash)
SELECT role_id, 'System Administrator', 'admin@reliefflow.local', 'REPLACE_WITH_ARGON2_HASH'
FROM roles WHERE role_name = 'ADMIN'
ON CONFLICT (email) DO NOTHING;

INSERT INTO resource_categories(category_name, description) VALUES
('WATER',   'Water supply: drinking water, treatment and storage (Sphere WASH standards)'),
('FOOD',    'Food assistance: dry rations and ready-to-eat food (Sphere food security standards)'),
('MEDICAL', 'Essential health supplies (Sphere health standards)'),
('SHELTER', 'Shelter and household items (Sphere shelter and settlement standards)'),
('HYGIENE', 'Hygiene promotion items (Sphere WASH standards)'),
('ENERGY',  'Lighting and power for shelters and households')
ON CONFLICT (category_name) DO NOTHING;

INSERT INTO resources(category_id, resource_name, unit, is_perishable, description)
SELECT c.category_id, v.name, v.unit, v.perishable, v.descr
FROM (VALUES
  ('WATER',   'Drinking Water',             'litre',   FALSE, 'Sphere: at least 15 L per person per day for drinking, cooking and personal hygiene.'),
  ('WATER',   'Water Purification Tablets', 'strip',   FALSE, 'Household water treatment; one strip treats about 200 L.'),
  ('WATER',   'Water Jerrycan 20 L',        'piece',   FALSE, 'Sphere: two clean water containers (10-20 L) per household.'),
  ('FOOD',    'Rice',                       'kg',      FALSE, 'Staple cereal; Sphere 2,100 kcal per person per day (about 0.4 kg cereal).'),
  ('FOOD',    'Pulses (Dal)',               'kg',      FALSE, 'Protein source; about 0.06 kg per person per day.'),
  ('FOOD',    'Cooking Oil',                'litre',   FALSE, 'Fortified oil; about 0.025 L per person per day.'),
  ('FOOD',    'Ready-to-Eat Meal',          'packet',  TRUE,  'For the first 72 hours before cooking is possible; one packet per person per meal.'),
  ('FOOD',    'Infant Formula',             'tin',     TRUE,  'Only for infants who cannot be breastfed; distributed under supervision.'),
  ('MEDICAL', 'ORS Sachets',                'sachet',  FALSE, 'Oral rehydration salts for diarrhoea and heat illness.'),
  ('MEDICAL', 'First Aid Kit',              'kit',     FALSE, 'Dressings, antiseptic and basic medicines for minor injuries.'),
  ('MEDICAL', 'Essential Medicines Kit',    'kit',     FALSE, 'Basic medicines for about 1,000 people for one month.'),
  ('MEDICAL', 'Insulin Vials',              'vial',    TRUE,  'Requires cold chain (2-8 °C).'),
  ('SHELTER', 'Family Tent',                'unit',    FALSE, 'Sphere: at least 3.5 m² of covered living space per person; one tent per family of five.'),
  ('SHELTER', 'Tarpaulin Sheet 4x6 m',      'piece',   FALSE, 'Emergency shelter and roof repair; two sheets per household.'),
  ('SHELTER', 'Blanket',                    'piece',   FALSE, 'Sphere: one per person, more in cold climates.'),
  ('SHELTER', 'Sleeping Mat',               'piece',   FALSE, 'One per person.'),
  ('SHELTER', 'Mosquito Net',               'piece',   FALSE, 'Long-lasting insecticidal net; one per two people.'),
  ('HYGIENE', 'Family Hygiene Kit',         'kit',     FALSE, 'Soap, toothpaste, toothbrushes, towel, sanitary items for a family of five for one month.'),
  ('HYGIENE', 'Bathing Soap 250 g',         'bar',     FALSE, 'Sphere: 250 g bathing soap per person per month.'),
  ('HYGIENE', 'Menstrual Hygiene Pack',     'pack',    FALSE, 'One pack per woman or girl of menstruating age per month.'),
  ('ENERGY',  'Solar Lantern',              'unit',    FALSE, 'One per household for lighting and phone charging.')
) AS v(category, name, unit, perishable, descr)
JOIN resource_categories c ON c.category_name = v.category
ON CONFLICT (category_id, resource_name) DO NOTHING;
