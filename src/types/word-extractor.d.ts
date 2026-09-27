declare module "word-extractor" {
  class WordExtractor {
    extract(source: string | Buffer): Promise<{ getBody(): string }>;
  }

  export = WordExtractor;
}