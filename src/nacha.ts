import { format } from 'date-fns';
import { z } from 'zod';

// ///////////////////////////////////////
// CONSTANTS
// ///////////////////////////////////////
export enum ServiceClass {
    CreditDebit = 200,
    Credit = 220,
    Debit = 225,
}

export enum TransactionCode {
    CheckingCredit = 22,
    CheckingDebit = 27,
    SavingsCredit = 32,
    SavingsDebit = 37,
}

export enum BatchCode {
    ARC = 'ARC',
    BOC = 'BOC',
    CCD = 'CCD',
    CIE = 'CIE',
    CTX = 'CTX',
    IAT = 'IAT',
    POP = 'POP',
    POS = 'POS',
    PPD = 'PPD',
    RCK = 'RCK',
    TEL = 'TEL',
    WEB = 'WEB',
}

const DEBIT_TYPES = [TransactionCode.CheckingDebit, TransactionCode.SavingsDebit];
const CREDIT_TYPES = [TransactionCode.CheckingCredit, TransactionCode.SavingsCredit];

const LINE_LENGTH = 94;

// ///////////////////////////////////////
// HELPERS
// ///////////////////////////////////////
const blankLine = '9'.repeat(LINE_LENGTH);

export const serviceClassFromNumber = (number: number) =>
    Object.keys(ServiceClass).find(
        (key) => ServiceClass[key as keyof typeof ServiceClass] === number,
    ) as keyof typeof ServiceClass | undefined;

export const batchCodeFromString = (str: string) =>
    Object.keys(BatchCode).find((key) => BatchCode[key as keyof typeof BatchCode] === str) as
        | keyof typeof BatchCode
        | undefined;

// ///////////////////////////////////////
// NACHA BATCH
// ///////////////////////////////////////
const DEFAULTS_BATCH_HEADER = {
    originStatusCode: '1',
};

const batchHeaderInputSchema = z.object({
    transactionTypes: z.nativeEnum(ServiceClass),
    originCompanyName: z.string().max(16),
    originDiscretionaryData: z.string().max(20).optional(),
    originIdentification: z.string().max(10),
    code: z.nativeEnum(BatchCode),
    description: z.string().max(10),
    descriptiveDate: z.date().optional(),
    effectiveEntryDate: z.date().optional().default(new Date()),
    originDfi: z.string().length(8),
    messageAuthenticationCode: z.string().length(19).optional(),
});

type BatchHeaderInput = z.input<typeof batchHeaderInputSchema>;
type BatchHeaderFields = z.infer<typeof batchHeaderInputSchema> & typeof DEFAULTS_BATCH_HEADER;

export class Batch {
    protected fields: BatchHeaderFields;
    protected entries: Entry[] = [];

    constructor(input: BatchHeaderInput) {
        const parsed = batchHeaderInputSchema.parse(input);

        this.fields = {
            ...DEFAULTS_BATCH_HEADER,
            ...parsed,
        };
    }

    addEntry(entry: Entry) {
        this.entries.push(entry);
    }

    getEntryCount() {
        return this.entries.length;
    }

    // TODO: Implement
    getEntriesAddendaCount() {
        return this.entries.reduce((acc, entry) => (entry.hasAddenda() ? acc + 1 : acc), 0);
    }

    getEntriesHash() {
        return this.entries.reduce((acc, entry) => acc + entry.getDfiIdentifier(), 0);
    }

    getEntriesDebitAmount() {
        return this.entries.reduce((acc, entry) => acc + entry.getDebitAmount(), 0);
    }

    getEntriesCreditAmount() {
        return this.entries.reduce((acc, entry) => acc + entry.getCreditAmount(), 0);
    }

    getHeader(number: number) {
        return [
            5,
            this.fields.transactionTypes,
            this.fields.originCompanyName.padEnd(16, ' '),
            (this.fields.originDiscretionaryData || '').padEnd(20, ' '),
            this.fields.originIdentification.padEnd(10, ' '),
            this.fields.code,
            this.fields.description.toUpperCase().padEnd(10, ' '),
            this.fields.descriptiveDate
                ? format(this.fields.descriptiveDate, 'yyMMdd')
                : ' '.repeat(6),
            format(this.fields.effectiveEntryDate, 'yyMMdd'),
            ' '.repeat(3),
            this.fields.originStatusCode,
            this.fields.originDfi,
            number.toString().padStart(7, '0'),
        ].join('');
    }

    getEntries() {
        return this.entries
            .map((entry, idx) => entry.toOutput(this.fields.code, this.fields.originDfi, idx + 1))
            .flat();
    }

    getTrailer(number: number) {
        const entryAddendaCount = this.getEntryCount() + this.getEntriesAddendaCount();

        const entryHash = this.getEntriesHash();
        const debitAmount = this.entries.reduce((acc, entry) => acc + entry.getDebitAmount(), 0);
        const creditAmount = this.entries.reduce((acc, entry) => acc + entry.getCreditAmount(), 0);

        return [
            8,
            this.fields.transactionTypes,
            entryAddendaCount.toString().padStart(6, '0'),
            entryHash.toString().padStart(10, '0'),
            debitAmount.toString().padStart(12, '0'),
            creditAmount.toString().padStart(12, '0'),
            this.fields.originIdentification.padEnd(10, ' '),
            (this.fields.messageAuthenticationCode || '').padEnd(19, ' '),
            ' '.repeat(6),
            this.fields.originDfi,
            number.toString().padStart(7, '0'),
        ].join('');
    }

    toOutput(number: number) {
        return [
            // Batch header
            this.getHeader(number),

            // Batch entries
            ...this.getEntries(),

            // Batch trailer
            this.getTrailer(number),
        ];
    }
}

// ///////////////////////////////////////
// NACHA ENTRY
// ///////////////////////////////////////
const DEFAULTS_ENTRY = {
    recordTypeCode: '6',
};

const entryInputSchema = z.object({
    transactionCode: z.nativeEnum(TransactionCode),
    destinationRoutingNumber: z.string().length(9),
    destinationAccountNumber: z.string().max(17),
    amount: z.number().int(),
    transactionId: z.string().regex(/^\d+$/).max(15).optional(),
    destinationName: z.string().max(22),
    discretionaryData: z.string().max(2).optional().default(''),
    addendaId: z.string().length(1).optional(),
});

type EntryInput = z.input<typeof entryInputSchema>;
type EntryFields = z.infer<typeof entryInputSchema> & typeof DEFAULTS_ENTRY;

export class Entry {
    protected fields: EntryFields;
    protected addenda?: EntryAddenda;

    constructor(input: EntryInput) {
        const parsed = entryInputSchema.parse(input);

        this.fields = {
            ...DEFAULTS_ENTRY,
            ...parsed,
        };
    }

    hasAddenda() {
        return !!this.addenda;
    }

    setAddenda(addenda: EntryAddenda) {
        this.addenda = addenda;
    }

    getDfiIdentifier() {
        return parseInt(this.fields.destinationRoutingNumber.slice(0, 8), 10);
    }

    getCreditAmount() {
        return CREDIT_TYPES.includes(this.fields.transactionCode) ? this.fields.amount : 0;
    }

    getDebitAmount() {
        return DEBIT_TYPES.includes(this.fields.transactionCode) ? this.fields.amount : 0;
    }

    getEntry(batchCode: string, originDfi: string, number: number) {
        return [
            this.fields.recordTypeCode,
            this.fields.transactionCode,
            this.fields.destinationRoutingNumber,
            this.fields.destinationAccountNumber.padEnd(17, ' '),
            this.fields.amount.toString().padStart(10, '0'),
            (this.fields.transactionId || '').padEnd(15, ' '),
            this.fields.destinationName.padEnd(22, ' '),
            (this.fields.discretionaryData || '').padEnd(2, ' '),
            this.addenda ? '1' : '0',
            originDfi,
            number.toString().padStart(7, '0'),
        ].join('');
    }

    getAddenda(number: number) {
        if (!this.addenda) {
            return undefined;
        }

        return this.addenda.toOutput(number.toString().padStart(7, '0'));
    }

    toOutput(batchCode: string, originDfi: string, number: number) {
        const lines = [this.getEntry(batchCode, originDfi, number)];

        const addenda = this.getAddenda(number);

        if (addenda) {
            lines.push(addenda);
        }

        return lines;
    }
}

// ///////////////////////////////////////
// NACHA ENTRY ADDENDA
// ///////////////////////////////////////
const DEFAULTS_ENTRY_ADDENDA = {
    recordTypeCode: '7',
    addendaTypeCode: '05',
    sequenceNumber: '1',
};

const entryAddendaInputSchema = z.object({
    info: z.string().max(80).optional(),
});

type EntryAddendaInput = z.input<typeof entryAddendaInputSchema>;
type EntryAddendaFields = z.infer<typeof entryAddendaInputSchema> & typeof DEFAULTS_ENTRY_ADDENDA;

export class EntryAddenda {
    protected fields: EntryAddendaFields;

    constructor(input: EntryAddendaInput) {
        const parsed = entryAddendaInputSchema.parse(input);

        this.fields = {
            ...DEFAULTS_ENTRY_ADDENDA,
            ...parsed,
        };
    }

    toOutput(trace: string) {
        return [
            this.fields.recordTypeCode,
            this.fields.addendaTypeCode,
            (this.fields.info || '').padEnd(80, ' '),
            this.fields.sequenceNumber.padStart(4, '0'),
            trace.padEnd(7, ' '),
        ].join('');
    }
}

// ///////////////////////////////////////
// NACHA
// ///////////////////////////////////////
const DEFAULTS_NACHA = {
    recordTypeCode: '1',
    priorityCode: '01',
    recordSize: `0${LINE_LENGTH}`,
    blockingFactor: '10',
    formatCode: '1',
};

const nachaInputSchema = z.object({
    originRoutingNumber: z.string().length(9),
    originName: z.string().max(23).optional(),
    destinationRoutingNumber: z.string().length(9),
    destinationName: z.string().max(23).optional(),
    fileCreationDate: z.date().optional().default(new Date()),
    fileIdModifier: z
        .string()
        .regex(/^[A-Z0-9]{1}$/, 'Value must be single character A-Z or 0-9')
        .optional()
        .default('A'),
    referenceCode: z.string().max(8).optional(),
});

type NachaInput = z.input<typeof nachaInputSchema>;
type NachaFields = z.infer<typeof nachaInputSchema> & typeof DEFAULTS_NACHA;

export class Nacha {
    protected fields: NachaFields;
    protected batches: Batch[] = [];

    constructor(input: NachaInput) {
        const parsed = nachaInputSchema.parse(input);

        this.fields = {
            ...DEFAULTS_NACHA,
            ...parsed,
        };
    }

    addBatch(batch: Batch) {
        this.batches.push(batch);
    }

    getHeader() {
        return [
            this.fields.recordTypeCode,
            this.fields.priorityCode,
            this.fields.destinationRoutingNumber.padStart(10, ' '),
            this.fields.originRoutingNumber.padStart(10, ' '),
            format(this.fields.fileCreationDate, 'yyMMdd'),
            format(this.fields.fileCreationDate, 'HHmm'),
            this.fields.fileIdModifier,
            this.fields.recordSize,
            this.fields.blockingFactor,
            this.fields.formatCode,
            (this.fields.destinationName || '').padEnd(23, ' '),
            (this.fields.originName || '').padEnd(23, ' '),
            (this.fields.referenceCode || '').padEnd(8, ' '),
        ].join('');
    }

    getTrailer(totalLines: number) {
        const blockCount = Math.ceil(totalLines / 10);

        const entryAddendaCount = this.batches.reduce(
            (acc, batch) => acc + batch.getEntryCount() + batch.getEntriesAddendaCount(),
            0,
        );
        const entriesHash = this.batches.reduce((acc, batch) => acc + batch.getEntriesHash(), 0);
        const debitAmount = this.batches.reduce(
            (acc, batch) => acc + batch.getEntriesDebitAmount(),
            0,
        );
        const creditAmount = this.batches.reduce(
            (acc, batch) => acc + batch.getEntriesCreditAmount(),
            0,
        );

        return [
            9,
            this.batches.length.toString().padStart(6, '0'),
            blockCount.toString().padStart(6, '0'),
            entryAddendaCount.toString().padStart(8, '0'),
            entriesHash.toString().padStart(10, '0'),
            debitAmount.toString().padStart(12, '0'),
            creditAmount.toString().padStart(12, '0'),
            ' '.repeat(39),
        ].join('');
    }

    toOutput() {
        const lines = [
            // File header
            this.getHeader(),

            // Each batch with its entries
            ...this.batches.map((batch, idx) => batch.toOutput(idx + 1)).flat(),
        ];

        lines.push(
            // File trailer
            this.getTrailer(lines.length + 1),
        );

        const leftOverLines = lines.length % 10;

        return [
            ...lines,
            ...Array(leftOverLines > 0 ? 10 - leftOverLines : 0).fill(blankLine),
        ].join('\n');
    }
}

// ///////////////////////////////////////
// TEST IMPLEMENTATION
// ///////////////////////////////////////
/* const nacha = new Nacha({
    originRoutingNumber: '011401533',
    originName: 'Some Bank',
    destinationRoutingNumber: '091000019',
    destinationName: 'Your Bank',
    fileCreationDate: new Date('2023-01-01T00:00:00.000Z'),
    fileIdModifier: 'A',
    referenceCode: '12',
});

const batchOne = new Batch({
    transactionTypes: ServiceClass.Credit,
    originCompanyName: 'Your Company Inc',
    originDiscretionaryData: 'A1',
    originIdentification: 'RAj2392',
    code: BatchCode.CCD,
    description: 'Payroll',
    descriptiveDate: new Date('2023-01-01T00:00:00.000Z'),
    effectiveEntryDate: new Date('2023-01-01T00:00:00.000Z'),
    originDfi: '01140153',
});

batchOne.addEntry(
    new Entry({
        transactionCode: TransactionCode.CheckingCredit,
        destinationRoutingNumber: '091000019',
        destinationAccountNumber: '1234567897',
        amount: 3521,
        transactionId: '000001309',
        destinationName: 'Leroy Jenkins',
    }),
);

const entry = new Entry({
    transactionCode: TransactionCode.CheckingCredit,
    destinationRoutingNumber: '091000019',
    destinationAccountNumber: '1234567897',
    amount: 50.5,
    transactionId: '000001313',
    destinationName: 'Leroy Jenkins',
});

entry.setAddenda(
    new EntryAddenda({
        info: 'Im a special boy',
    }),
);

batchOne.addEntry(entry);
nacha.addBatch(batchOne);

const batchTwo = new Batch({
    transactionTypes: ServiceClass.Debit,
    originCompanyName: 'Your Company Inc',
    originDiscretionaryData: 'A1',
    originIdentification: 'Foobar',
    code: BatchCode.CCD,
    description: 'You Know',
    descriptiveDate: new Date('2024-04-01T00:00:00.000Z'),
    effectiveEntryDate: new Date('2024-04-01T00:00:00.000Z'),
    originDfi: '01140153',
});

batchTwo.addEntry(
    new Entry({
        transactionCode: TransactionCode.CheckingDebit,
        destinationRoutingNumber: '091000019',
        destinationAccountNumber: '1234567897',
        amount: 3.5,
        transactionId: '5051309',
        destinationName: 'Richard Branson',
    }),
);

nacha.addBatch(batchTwo);

writeFileSync('test.txt', nacha.toOutput()); */
