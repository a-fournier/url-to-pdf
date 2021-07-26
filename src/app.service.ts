import {Injectable} from '@nestjs/common';
import {InjectQueue} from "@nestjs/bull";
import {Job, JobId, Queue} from "bull";
import {GENERATE_PDF_NAME} from "./constants";
import {Params, PdfParams} from "./type";
import {ConfigService} from "@nestjs/config";
import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';

@Injectable()
export class AppService {
  constructor(@InjectQueue(GENERATE_PDF_NAME) private generatePdfQueue: Queue, private configService: ConfigService) {}

  private static readPDFParams(params: any):PdfParams {
    return {
      scale: +params.scale || 1,
      margin: {
        top: params.margin?.top || 0,
        left: params.margin?.left || 0,
        bottom: params.margin?.bottom || 0,
        right: params.margin?.right || 0,
      },
      width: params.width,
      height: params.height,
      landscape: params.landscape || true,
      printBackground: params.printBackground || true,
      title: params.title,
    };
  }

  async createJob(params: Params): Promise<Job> {
    return this.generatePdfQueue.add(params);
  }

  async getJob(id: JobId): Promise<Job> {
    return this.generatePdfQueue.getJob(id);
  }

  async generatePdf({url, waitUntil, ...params}: Params): Promise<string> {
    const puppeteer = require('puppeteer');
    const pdfParams = AppService.readPDFParams(params);
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
    });

    const page = await browser.newPage();

    await page.goto(url);

    await page.evaluate(params => {
      sessionStorage.setItem('body', JSON.stringify(params.body));
    }, params);

    await page.goto(url, {waitUntil: waitUntil});

    await page.evaluateHandle('document.fonts.ready');

    if (!pdfParams.title) pdfParams.title = await page.title();

    const pdf = await page.pdf(pdfParams);
    browser.close().then();
    return this.uploadPdf(pdfParams.title + '.pdf', pdf)
  }

  async uploadPdf(fileName: string, pdf: any) {
    const id = Date.now();
    const client = new S3Client({
      region: this.configService.get('aws.s3.region'),
      credentials: {
        accessKeyId: this.configService.get('aws.accessKeyId'),
        secretAccessKey: this.configService.get('aws.secretAccessKey'),
      }});

    await client.send(new PutObjectCommand({
      Bucket: this.configService.get('aws.s3.bucketName'),
      Key: `${id}/${fileName}`,
      Body: pdf,
      ACL: "public-read"
    }));
    return `${this.configService.get('aws.cloudfront.uri')}/${id}/${fileName}`
  }
}