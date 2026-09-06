import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PriceMinorGranularity1756600000006 implements MigrationInterface {
  public name = 'PriceMinorGranularity1756600000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Контракт вебхука принимает только целые major-суммы (@IsInt amount ⇒ amountMinor кратен
    // 100), а guardAmount сверяет их с orders.total_minor = products.price_minor. Товар с
    // некруглой ценой (49999) поэтому неоплачиваем навсегда: любая легальная сумма даёт
    // rejected_amount. Ограничение держит инвариант на уровне БД — единственном месте, куда
    // цена попадает и из сидера, и из админки, и вручную.
    await queryRunner.query(`
      ALTER TABLE products
        ADD CONSTRAINT products_price_granularity_ck CHECK (price_minor % 100 = 0);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE products DROP CONSTRAINT products_price_granularity_ck;`);
  }
}
