alter table barcox.scan_sessions
  add column if not exists product_name text
  check (product_name is null or char_length(product_name) <= 120);
