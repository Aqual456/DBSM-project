-- Allocation history cannot be erased or silently resurrected.
DROP TRIGGER IF EXISTS trg_validate_allocation_item ON allocation_items;
CREATE TRIGGER trg_validate_allocation_item BEFORE INSERT OR UPDATE OR DELETE ON allocation_items FOR EACH ROW EXECUTE FUNCTION validate_allocation_item();
CREATE OR REPLACE FUNCTION allocation_status_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.request_id<>OLD.request_id OR NEW.allocated_by<>OLD.allocated_by OR NEW.allocated_at<>OLD.allocated_at THEN RAISE EXCEPTION 'Allocation identity is immutable'; END IF;
 IF NEW.status=OLD.status THEN RETURN NEW; END IF;
 PERFORM 1 FROM resource_requests WHERE request_id=NEW.request_id FOR UPDATE;
 IF NOT ((OLD.status='ALLOCATED' AND NEW.status IN ('IN_TRANSIT','CANCELLED')) OR (OLD.status='IN_TRANSIT' AND NEW.status='DELIVERED')) THEN RAISE EXCEPTION 'Invalid allocation transition'; END IF;
 IF NEW.status='CANCELLED' THEN
  IF EXISTS(SELECT 1 FROM deliveries WHERE allocation_id=NEW.allocation_id AND status<>'CANCELLED') THEN RAISE EXCEPTION 'Cancel planned deliveries before cancelling allocation'; END IF;
  PERFORM set_config('reliefflow.reason','Allocation cancellation #'||NEW.allocation_id,true);
  PERFORM 1 FROM inventory i JOIN allocation_items ai USING(warehouse_id,resource_id) WHERE ai.allocation_id=NEW.allocation_id ORDER BY i.warehouse_id,i.resource_id FOR UPDATE OF i;
  UPDATE inventory i SET quantity_available=i.quantity_available+x.quantity,last_updated=now() FROM (SELECT warehouse_id,resource_id,sum(quantity_allocated) quantity FROM allocation_items WHERE allocation_id=NEW.allocation_id GROUP BY warehouse_id,resource_id) x WHERE i.warehouse_id=x.warehouse_id AND i.resource_id=x.resource_id;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS allocation_status_guard ON allocations;
CREATE TRIGGER allocation_status_guard BEFORE UPDATE ON allocations FOR EACH ROW EXECUTE FUNCTION allocation_status_guard();
