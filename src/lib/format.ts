// One formatting convention for the whole UI, independent of the viewer's browser locale:
// numbers "12,345", dates "27 Oct 2026", date-times "27 Oct 2026, 23:52".

const NUMBER = new Intl.NumberFormat("en");
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const formatNumber = (n: number) => NUMBER.format(n);

export const formatDate = (d: string | number | Date) => DATE.format(new Date(d));

export const formatDateTime = (d: string | number | Date) => DATE_TIME.format(new Date(d));
