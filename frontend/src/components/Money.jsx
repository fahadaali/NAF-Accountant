/**
 * وسيط إلى عنصر `Money` من `naf-currency` في السجلّ.
 * عنصر السجلّ يعرض الرمز U+20C1 ويتولّى البديل «ر.س» عند تعذّر الخط،
 * ويلفّ المبلغ في bdi، ويأخذ تنسيقه من naf-format حصراً.
 */
export { Money as default, Money } from '../naf/currency/money.jsx';
