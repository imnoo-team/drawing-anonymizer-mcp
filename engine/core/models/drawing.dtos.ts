export interface IDrawingDataDto {
    tenantId: number;
    id: string;
    analysisVersion: number;
    pages: {
        [key: number]: IDrawingPageDto;
    };
    error?: IAnalysisError;
}
export interface IFileStoreDrawingDataDto extends IDrawingDataDto {
    mainPageNr?: number | null;
    predefinedMainPageNr?: number | null;
}
export interface IAnalysisError {
    errorMsg: string;
    analysisErrorCode: AnalysisErrorCodes;
}
export interface IDrawingPageDto {
    pageNr: number;
    title?: string;
    height: number;
    width: number;
    dpi: number;
    rotation: number;
    isDrawing: boolean;
    imperialUnits: boolean;
    imageEmbedding?: number[];
    figuresEmbeddings?: number[][];
    tablesEmbeddings?: number[][];
    shape?: string;
    drawingNr?: string;
    articleNr?: string;
    materialAliases: string[];
    generalToleranceIso27681?: string;
    generalToleranceIso27682?: string;
    generalSurfaceToleranceId?: string;
    dimensionalTolerancesDifficultyStd: number;
    dimensionalTolerancesDifficultyMean: number;
    toleratedDrillsAndShaftsDifficultyStd: number;
    toleratedDrillsAndShaftsDifficultyMean: number;
    threadsDifficultyStd: number;
    threadsDifficultyMean: number;
    fineThreadsDifficultyStd: number;
    fineThreadsDifficultyMean: number;
    threads: IThreadGroupDto[];
    fineThreads: IThreadGroupDto[];
    dimensionalTolerances: IDimensionalTolerancesGroupDto[];
    geometricalTolerances: IGeometricalGroupDto[];
    surfaceTolerances: ISurfaceToleranceDto[];
    sensitiveData: ISensitiveDataItemDto[];
}
export interface IThreadGroupDto {
    id: string;
    count: number;
    size?: string;
    color?: string;
    diameter?: number | null;
    drawingObjects: IThreadDto[];
    imperial?: boolean | null;
}
export interface IThreadDto extends IDrawingObjectDto {
    orientation?: ObjectOrientationEnumeration | null;
}
export interface IDimensionalTolerancesGroupDto {
    id: string;
    count: number;
    size?: string;
    imperial?: boolean | null;
    hasDiameter?: boolean | null;
    isDinInterpolated: boolean;
    color?: string;
    originalBoundaryFormat?: BoundaryFormatEnum | null;
    type: DimensionalToleranceType;
    boundary: IToleranceBoundary;
    drawingObjects: IDrawingObjectDto[];
}
export interface IGeometricalGroupDto {
    id: string;
    count: number;
    value?: number | null;
    constraint?: string;
    imperial?: boolean | null;
    color?: string;
    drawingObjects: IDrawingObjectDto[];
}
export interface ISurfaceToleranceDto {
    id: string;
    instanceId?: number | null;
    profile: string;
    amplitude?: number | null;
    standardAmplitude?: number | null;
    isGeneral?: boolean | null;
    isMain?: boolean | null;
    isCircumferential?: boolean | null;
    imperial?: boolean | null;
    isMachiningRequired?: boolean | null;
    isMachiningOptional?: boolean | null;
    isMachiningProhibited?: boolean | null;
    color: string;
    drawingObject: IDrawingObjectDto;
}
export interface IDrawingObjectDto {
    id: string;
    instanceId?: number | null;
    boundingBox: IRectangleDto;
    score: number;
}
export interface IRectangleDto {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface ISensitiveDataItemDto extends IDrawingObjectDto {
    type: SensitiveDataType;
    color: string;
    originalBackgroundColorHex: string;
    originalValue: string;
    replacementValue: string;
    fontSize?: number | null;
    fontColorHex: string;
    textRotation?: number | null;
}
export interface IToleranceBoundary {
    upper?: number | null;
    lower?: number | null;
    din?: string;
}
export enum SensitiveDataType {
    ArticleNr = 'ArticleNr',
    DrawingNr = 'DrawingNr',
    CompanyName = 'CompanyName',
    CompanyLogo = 'CompanyLogo',
    Name = 'Name',
    Address = 'Address',
    PhoneNr = 'PhoneNr',
    Date = 'Date',
    Email = 'Email',
    Website = 'Website',
    Other = 'Other'
}
export enum AnalysisErrorCodes {
    Unknown = 'Unknown',
    CorruptedFile = 'CorruptedFile',
    NoDrawings = 'NoDrawings',
    TooManyDrawings = 'TooManyDrawings',
    ServerError = 'ServerError'
}
export enum DimensionalToleranceType {
    Dimensional = 'Dimensional',
    Drill = 'Drill',
    Shaft = 'Shaft'
}
export enum ObjectOrientationEnumeration {
    Side = 'Side',
    Top = 'Top',
    Empty = 'Empty'
}
export enum BoundaryFormatEnum {
    Unknown = 'Unknown',
    Din = 'Din',
    UpperLower = 'UpperLower'
}
