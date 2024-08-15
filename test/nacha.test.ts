import { expect } from 'chai';
import { parse } from 'date-fns';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import {
    Batch,
    BatchCode,
    batchCodeFromString,
    Entry,
    EntryAddenda,
    Nacha,
    ServiceClass,
    serviceClassFromNumber,
} from '../src/nacha.js';

const caseDirectories = readdirSync(join(process.cwd(), 'test', 'cases'));

const cases = caseDirectories.map((directory) => {
    return {
        name: directory,
        nacha: readFileSync(join(process.cwd(), 'test', 'cases', directory, 'case.txt'), 'utf8'),
        json: JSON.parse(
            readFileSync(join(process.cwd(), 'test', 'cases', directory, 'case.json'), 'utf8'),
        ) as unknown as MoovRoot,
    };
});

const stripEmptyString = (str: string) => {
    const stripped = str.replace(/\s+/g, '').trim();

    return stripped.length === 0 ? undefined : stripped;
};

describe('Integration tests', () => {
    cases.forEach(({ name, nacha: nachaText, json }) => {
        it(`should match ${name}`, () => {
            const nacha = new Nacha({
                fileCreationDate: parse(json.fileHeader.fileCreationDate, 'yyMMdd', new Date()),
                fileIdModifier: json.fileHeader.fileIDModifier,
                originName: json.fileHeader.immediateOriginName,
                destinationName: json.fileHeader.immediateDestinationName,
                originRoutingNumber: json.fileHeader.immediateOrigin,
                destinationRoutingNumber: json.fileHeader.immediateDestination,
                referenceCode: json.fileHeader.referenceCode?.padEnd(8, ' '),
            });

            json.batches.forEach((nachaBatch) => {
                const code = batchCodeFromString(nachaBatch.batchHeader.standardEntryClassCode);

                if (!code) {
                    throw new Error(
                        `Unknown batch code: ${nachaBatch.batchHeader.standardEntryClassCode}`,
                    );
                }

                const transactionTypes = serviceClassFromNumber(
                    nachaBatch.batchHeader.serviceClassCode,
                );

                if (!transactionTypes) {
                    throw new Error(
                        `Unknown service class code: ${nachaBatch.batchHeader.serviceClassCode}`,
                    );
                }

                const batch = new Batch({
                    transactionTypes: ServiceClass[transactionTypes],
                    originCompanyName: nachaBatch.batchHeader.companyName,
                    originDiscretionaryData: nachaBatch.batchHeader.discretionaryData,
                    originIdentification: nachaBatch.batchHeader.companyIdentification,
                    code: BatchCode[code],
                    description: nachaBatch.batchHeader.companyEntryDescription,
                    descriptiveDate: nachaBatch.batchHeader.descriptiveDate
                        ? parse(nachaBatch.batchHeader.descriptiveDate, 'yyMMdd', new Date())
                        : undefined,
                    effectiveEntryDate: parse(
                        nachaBatch.batchHeader.effectiveEntryDate,
                        'yyMMdd',
                        new Date(),
                    ),
                    originDfi: nachaBatch.batchHeader.ODFIIdentification,
                });

                nachaBatch.entryDetails.forEach((nachaEntry) => {
                    const entry = new Entry({
                        transactionCode: nachaEntry.transactionCode,
                        destinationRoutingNumber: `${nachaEntry.RDFIIdentification}${nachaEntry.checkDigit}`,
                        destinationAccountNumber: nachaEntry.DFIAccountNumber,
                        amount: nachaEntry.amount,
                        transactionId: stripEmptyString(nachaEntry.identificationNumber),
                        destinationName: nachaEntry.individualName,
                        discretionaryData: stripEmptyString(nachaEntry.discretionaryData),
                    });

                    if (nachaEntry.addenda05) {
                        nachaEntry.addenda05.forEach((addenda) => {
                            const addendaEntry = new EntryAddenda({
                                info: addenda.paymentRelatedInformation,
                            });

                            entry.setAddenda(addendaEntry);
                        });
                    }

                    batch.addEntry(entry);
                });

                nacha.addBatch(batch);
            });

            const output = nacha.toOutput();

            expect(output).to.equal(nachaText);
        });
    });
});

export interface MoovRoot {
    IATBatches: null;
    NotificationOfChange: null;
    ReturnEntries: null;
    batches: MoovBatch[];
    fileADVControl: MoovFileControl;
    fileControl: MoovFileControl;
    fileHeader: MoovFileHeader;
    id: string;
}

export interface MoovBatch {
    batchControl: MoovBatchControl;
    batchHeader: MoovBatchHeader;
    entryDetails: MoovEntryDetail[];
    offset: null;
}

export interface MoovBatchControl {
    ODFIIdentification: string;
    batchNumber: number;
    companyIdentification: string;
    entryAddendaCount: number;
    entryHash: number;
    id: string;
    serviceClassCode: number;
    totalCredit: number;
    totalDebit: number;
}

export interface MoovBatchHeader {
    ODFIIdentification: string;
    batchNumber: number;
    companyEntryDescription: string;
    companyIdentification: string;
    companyName: string;
    effectiveEntryDate: string;
    descriptiveDate?: string;
    id: string;
    originatorStatusCode: number;
    serviceClassCode: number;
    settlementDate: string;
    standardEntryClassCode: string;
    discretionaryData?: string;
}

export interface MoovEntryDetail {
    DFIAccountNumber: string;
    RDFIIdentification: string;
    amount: number;
    category: string;
    checkDigit: string;
    discretionaryData: string;
    id: string;
    identificationNumber: string;
    individualName: string;
    traceNumber: string;
    transactionCode: number;
    addenda05?: MoovAddenda05[];
    addendaRecordIndicator?: number;
}

export interface MoovFileControl {
    batchCount: number;
    entryAddendaCount: number;
    entryHash: number;
    id: string;
    totalCredit: number;
    totalDebit: number;
    blockCount?: number;
}

export interface MoovFileHeader {
    fileCreationDate: string;
    fileCreationTime: string;
    fileIDModifier: string;
    id: string;
    immediateDestination: string;
    immediateDestinationName: string;
    immediateOrigin: string;
    immediateOriginName: string;
    referenceCode?: string;
}

export interface MoovAddenda05 {
    entryDetailSequenceNumber: number;
    id: string;
    paymentRelatedInformation: string;
    sequenceNumber: number;
    typeCode: string;
}
