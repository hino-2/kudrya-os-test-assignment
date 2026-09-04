# Полный Data Flow заказа

## **POST /orders** — создание заказа

```
Запрос → OrdersController.create()
  ↓
Транзакция (UnitOfWorkService):
  1. Check: client_order_id уже существует? → вернуть старый заказ (idempotent)
  2. Check: SKU существует и активен?
  3. Генерируем ext_id (внешний ID)
  4. INSERT orders: ext_id, product_id, sku, quantity, цена, валюта
  5. Статус = CREATED
  ↓
Логируем: ORDER_CREATED
  ↓
Ответ: 201 Created (или 200 Replay если дедубль)
```

---

## **Ответвление 1: Payment Webhook** (POST /payments/webhook)

```
Внешняя система платежа → PaymentWebhookService
  ↓
Транзакция:
  1. INSERT payment_event (статус PENDING)
  2. Lock заказ (FOR UPDATE)
  3. Check: сумма = order.total? валюта совпадает?
  4. Check: платеж не старый (не раньше last_payment_event_at)?
  5. State machine: CREATED→PAID или CREATED→PAYMENT_FAILED
  6. UPDATE orders: статус, paid_at или failure_reason, lastPaymentEventId/At
  ↓
Если PAID:
  ├─ INSERT ledger (финансовая запись типа PAYMENT_CAPTURED)
  ├─ ENQUEUE job: kind=DELIVER_ORDER payload={orderId, ext_id, generation}
  └─ Финализируй payment_event (статус APPLIED)
  ↓
Если FAILED:
  └─ Финализируй payment_event (статус APPLIED)

Если конфликт/дубль/orphan:
  └─ Финализируй payment_event (статус CONFLICT/ORPHAN/DUPLICATE)
```

---

## **Ответвление 2: Job Worker** (фоновый сервис, тик каждые 200ms)

```
JobWorkerService.tick()
  ↓
Claim DELIVER_ORDER jobs из jobs таблицы
  ↓
DeliverOrderHandler.handle(job)
  ↓
DeliveryService.deliver():
  1. Найти fulfillment mode заказа (pool или supplier)
  2. Вызвать нужный fulfilment service
  ↓
PoolFulfilmentService или SupplierFulfilmentService:
  1. Попытка выдать товар (call к external API или local stub)
  2. INSERT delivered_attempts (запись попытки)
  ↓
Если успех:
  └─ UPDATE order: status=DELIVERED, deliveredAt
Если out_of_stock:
  └─ UPDATE order: status=OUT_OF_STOCK
Если fail:
  └─ UPDATE order: status=DELIVERY_FAILED
  └─ Job retry с exponential backoff
```

---

## **Сущности в БД**

| Таблица               | Назначение                                                  |
| --------------------- | ----------------------------------------------------------- |
| **orders**            | Основные данные заказа (статус, цена, товар)                |
| **payment_events**    | История всех платежей (PENDING→APPLIED или ORPHAN/CONFLICT) |
| **issued_deliveries** | Запись о выданном заказе (когда, кому выдан)                |
| **delivery_attempts** | Каждая попытка выдачи + результат                           |
| **jobs**              | Очередь (PENDING→RUNNING→DONE или DEAD)                     |
| **ledger**            | Финансовый учет (дебеты/кредиты)                            |

---

## **Побочные эффекты**

✓ **Logging** — события ORDER_CREATED, PAYMENT_RECEIVED, DELIVERY_ENQUEUED и т.д.  
✓ **Job queue** — асинхронная обработка доставки  
✓ **Ledger** — финансовая история при оплате  
✓ **Payment events** — для audit  
✓ **External integrations** — calls к supplier API или pool delivery  
✓ **State machine** — валидация переходов статусов
