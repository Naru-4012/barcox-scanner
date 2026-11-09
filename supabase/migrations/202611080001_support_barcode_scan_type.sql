alter table barcox.scan_items
  drop constraint if exists scan_items_scan_type_check;

alter table barcox.scan_items
  add constraint scan_items_scan_type_check
  check (scan_type in ('qr', 'barcode', 'manual'));
