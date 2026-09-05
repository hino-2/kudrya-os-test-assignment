import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAttemptGeneration1756600000005 implements MigrationInterface {
  public name = 'AddAttemptGeneration1756600000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // DEFAULT намеренно нет: каждая вставка обязана назвать поколение явно, иначе пропущенный
    // параметр упадёт ошибкой, а не запишет молча 0 (и не склеит попытки разных поколений)
    await queryRunner.query(`ALTER TABLE delivery_attempts ADD COLUMN delivery_generation INTEGER NULL;`);

    // Бэкфилл: поколение уже записано внутри request_id
    // (buildSupplierRequestId -> 'req_<ext>-g<gen>-<S><n>'). Шаблон обязательно якорится на
    // хвост '-g<gen>-<A|B><n>$': client_order_id допускает '-' и цифры, поэтому 'ord_a-g5-x'
    // — легальный ext_id, и незаякоренный POSIX substring вернул бы ЛЕВОЕ вхождение (5 вместо
    // настоящего поколения). A/B в хвосте гарантирует delivery_attempts_supp_ck.
    // Фолбэк на текущее поколение заказа нужен только для строк, вставленных вручную
    // (фикстуры тестов), — у них request_id произвольный и шаблону не соответствует.
    await queryRunner.query(`
      UPDATE delivery_attempts a
      SET delivery_generation = COALESCE(
            NULLIF(substring(a.request_id from '-g([0-9]+)-[AB][0-9]+$'), '')::int,
            o.delivery_generation)
      FROM orders o
      WHERE o.id = a.order_id;
    `);

    await queryRunner.query(`ALTER TABLE delivery_attempts ALTER COLUMN delivery_generation SET NOT NULL;`);

    // attempt_no снова начинается с 1 в каждом поколении — без поколения в ключе повторная
    // выдача после restock/redeliver падала бы на 23505. request_id менять не нужно: он уже
    // несёт 'g<gen>', поэтому delivery_attempts_request_uq остаётся уникальным.
    await queryRunner.query(`ALTER TABLE delivery_attempts DROP CONSTRAINT delivery_attempts_slot_uq;`);

    // Этот констрейнт не является целью ON CONFLICT (её роль играет частичный
    // delivery_attempts_open_uq), поэтому ошибка планировщика с повторным выбором занятого
    // слота даст 23505, а не молчаливый дубль запроса к поставщику. Так и задумано.
    await queryRunner.query(`
      ALTER TABLE delivery_attempts
        ADD CONSTRAINT delivery_attempts_slot_uq
        UNIQUE (order_id, delivery_generation, supplier_code, attempt_no);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE delivery_attempts DROP CONSTRAINT delivery_attempts_slot_uq;`);

    // Возврат узкого констрейнта упадёт, если в таблице есть попытки нескольких поколений
    // с одним слотом (order_id, supplier_code, attempt_no). Это правильное поведение:
    // обратная миграция не должна молча удалять строки, чтобы «уместиться» в старую схему.
    await queryRunner.query(`
      ALTER TABLE delivery_attempts
        ADD CONSTRAINT delivery_attempts_slot_uq
        UNIQUE (order_id, supplier_code, attempt_no);
    `);

    await queryRunner.query(`ALTER TABLE delivery_attempts DROP COLUMN delivery_generation;`);
  }
}
