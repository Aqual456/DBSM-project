INSERT INTO roles(role_name, description) VALUES
('ADMIN','System administrator'),('RELIEF_COORDINATOR','Coordinates disaster response'),
('FIELD_OFFICER','Submits field requests'),('DRIVER','Transports allocated relief supplies')
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO app_users(role_id, full_name, email, password_hash, phone)
SELECT role_id, 'Demo Admin', 'admin@reliefflow.local', 'REPLACE_WITH_ARGON2_HASH', '+910000000001'
FROM roles WHERE role_name='ADMIN'
ON CONFLICT (email) DO NOTHING;

INSERT INTO locations(location_name, location_type, address, latitude, longitude)
VALUES ('Central Relief Zone','DISTRICT','Bengaluru, Karnataka',12.971600,77.594600),
       ('North Relief Camp Zone','CAMP_AREA','Yelahanka, Bengaluru',13.100700,77.596300)
ON CONFLICT DO NOTHING;

INSERT INTO resource_categories(category_name, description) VALUES
('FOOD','Food and nutrition supplies'),('WATER','Drinking water'),('MEDICAL','Medical supplies'),('SHELTER','Shelter and bedding')
ON CONFLICT (category_name) DO NOTHING;

INSERT INTO resources(category_id, resource_name, unit, is_perishable)
SELECT category_id, v.resource_name, v.unit, v.perishable
FROM (VALUES ('FOOD','Food Packet','packet',TRUE),('WATER','Drinking Water','litre',FALSE),('MEDICAL','First Aid Kit','kit',FALSE),('SHELTER','Blanket','piece',FALSE)) AS v(category_name,resource_name,unit,perishable)
JOIN resource_categories c ON c.category_name=v.category_name
ON CONFLICT (category_id, resource_name) DO NOTHING;
