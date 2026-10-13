-- Sprint 08 — ejecutar manualmente SOLO en un proyecto de prueba con dos usuarios/clubes.
-- No es idempotente y no debe correrse sobre datos operativos sin adaptar los UUID.
-- Requiere la migración 20261013070000_canteen.sql aplicada.

-- 1) Como owner/admin del club A, crear una categoría y un producto en centavos.
-- insert into public.canteen_categories (club_id, name) values ('<club_a>', 'Bebidas') returning id;
-- insert into public.canteen_products (club_id, category_id, name, sale_price_cents) values ('<club_a>', '<category>', 'Cerveza', 300000) returning id;
-- Confirmar que staff no puede insertar/editar categorías ni productos (42501/RLS).

-- 2) Venta inmediata: no se pasa ningún precio desde el cliente.
-- select * from public.create_canteen_sale('<club_a>', '[{"product_id":"<product>","quantity":2}]'::jsonb, null, 'cash', '<request_uuid>');
-- Confirmar un ítem con unit_price_cents=300000 y un pago por el total.
-- Cambiar canteen_products.sale_price_cents y confirmar que canteen_sale_items conserva el precio histórico.

-- 3) Venta pendiente: debe rechazar cliente nulo; con persona del club crea venta sin pago.
-- select * from public.create_canteen_sale('<club_a>', '[{"product_id":"<product>","quantity":1}]'::jsonb, '<person_a>', null, '<request_uuid>');
-- select * from public.create_canteen_sale('<club_a>', '[]'::jsonb, '<person_a>', null, '<request_uuid>'); -- espera 22023
-- select * from public.create_canteen_sale('<club_a>', '[{"product_id":"<product>","quantity":1}]'::jsonb, null, null, '<request_uuid>'); -- espera 22023

-- 4) Idempotencia y atomicidad: repetir exactamente el client_request_id no crea otra venta/ítems/pago.
-- Repetir la llamada de arriba y verificar una sola fila en canteen_sales para (club_id, client_request_id).
-- Provocar producto ajeno/inactivo: la llamada falla y no debe quedar una venta ni un ítem parcial.

-- 5) Pago parcial y total, como owner/admin o staff del club A.
-- select * from public.record_canteen_sale_payment('<club_a>', '<pending_sale>', 100000, current_date, 'cash');
-- select * from public.record_canteen_sale_payment('<club_a>', '<pending_sale>', 200000, current_date, 'bank_transfer');
-- Intentar importe mayor al saldo: espera 22023.
-- En dos sesiones simultáneas registrar el saldo completo: una debe confirmar y la otra fallar 22023; el total de pagos no supera canteen_sales.total_cents.

-- 6) Anulación: como owner/admin, anular solo venta sin pagos con motivo no vacío.
-- select * from public.void_canteen_sale('<unpaid_sale>', 'Carga duplicada');
-- Intentar anular una venta con pago: espera 22023. Como staff: espera 42501.

-- 7) Aislamiento/RLS: con usuario del club B no se deben listar filas de club A ni poder invocar RPC con IDs de A (42501/23503).
-- select * from public.canteen_sales where club_id = '<club_a>';
-- select * from public.record_canteen_sale_payment('<club_a>', '<pending_sale>', 100, current_date, 'cash');
