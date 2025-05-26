import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Config } from './types.js';
import { logger } from './logger.js';

const execAsync = promisify(exec);

// Configuration constants for analysis limits and thresholds
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB max file size
const MAX_CONCURRENT_ANALYSIS = 10; // Limit concurrent file analysis
const COMPLEXITY_THRESHOLD = 10; // Cyclomatic complexity threshold
const MAINTAINABILITY_THRESHOLD = 65; // Maintainability index threshold

/**
 * Represents the structure and metrics of a code file
 */
export interface FileAnalysis {
	filePath: string;
	extension: string;
	lines: number;
	size: number;
	complexity: number;
	dependencies: string[];
	exports: string[];
	functions: string[];
	classes: string[];
	interfaces: string[];
	imports: ImportInfo[];
	maintainabilityIndex: number;
	technicalDebt: TechnicalDebtItem[];
	lastModified: Date;
}

/**
 * Represents import information in a code file
 */
export interface ImportInfo {
	source: string;
	imports: string[];
	isExternal: boolean;
	isRelative: boolean;
}

/**
 * Represents a technical debt item found during analysis
 */
export interface TechnicalDebtItem {
	type: 'todo' | 'fixme' | 'hack' | 'deprecated' | 'complexity' | 'duplication';
	severity: 'low' | 'medium' | 'high' | 'critical';
	description: string;
	location: {
		line: number;
		column?: number;
	};
	estimatedEffort: 'small' | 'medium' | 'large';
}

/**
 * Represents the overall architecture analysis of the codebase
 */
export interface ArchitectureAnalysis {
	projectStructure: ProjectStructure;
	dependencyGraph: DependencyGraph;
	codeMetrics: CodeMetrics;
	architecturalPatterns: ArchitecturalPattern[];
	qualityGates: QualityGate[];
	improvementSuggestions: ImprovementSuggestion[];
	testCoverage: TestCoverageInfo;
	performanceMetrics: PerformanceMetric[];
}

/**
 * Represents the project's directory structure and organization
 */
export interface ProjectStructure {
	directories: DirectoryInfo[];
	filesByType: Map<string, number>;
	layerCompliance: LayerCompliance;
	moduleOrganization: ModuleInfo[];
}

/**
 * Represents directory information and organization
 */
export interface DirectoryInfo {
	path: string;
	fileCount: number;
	purpose: string;
	complexity: number;
	depth: number;
}

/**
 * Represents dependency relationships between modules
 */
export interface DependencyGraph {
	nodes: DependencyNode[];
	edges: DependencyEdge[];
	circularDependencies: CircularDependency[];
	dependencyMetrics: DependencyMetrics;
}

/**
 * Represents a node in the dependency graph
 */
export interface DependencyNode {
	id: string;
	filePath: string;
	type: 'internal' | 'external' | 'builtin';
	importance: number;
	fanIn: number;
	fanOut: number;
}

/**
 * Represents an edge in the dependency graph
 */
export interface DependencyEdge {
	from: string;
	to: string;
	type: 'import' | 'require' | 'dynamic';
	weight: number;
}

/**
 * Represents a circular dependency in the codebase
 */
export interface CircularDependency {
	cycle: string[];
	severity: 'low' | 'medium' | 'high';
	impactScore: number;
}

/**
 * Comprehensive code metrics for the entire codebase
 */
export interface CodeMetrics {
	totalLines: number;
	totalFiles: number;
	averageComplexity: number;
	duplicatedLines: number;
	technicalDebtHours: number;
	maintainabilityScore: number;
	testCoveragePercentage: number;
	codeChurn: number;
}

/**
 * Represents an architectural pattern found in the codebase
 */
export interface ArchitecturalPattern {
	name: string;
	description: string;
	files: string[];
	confidence: number;
	benefits: string[];
	concerns: string[];
}

/**
 * Represents a quality gate that measures code quality
 */
export interface QualityGate {
	name: string;
	description: string;
	threshold: number;
	currentValue: number;
	status: 'pass' | 'warn' | 'fail';
	trend: 'improving' | 'stable' | 'degrading';
}

/**
 * Represents a suggestion for improving the codebase
 */
export interface ImprovementSuggestion {
	category: 'architecture' | 'performance' | 'maintainability' | 'security' | 'testing';
	priority: 'critical' | 'high' | 'medium' | 'low';
	title: string;
	description: string;
	affectedFiles: string[];
	estimatedEffort: 'small' | 'medium' | 'large' | 'epic';
	expectedBenefit: string;
	implementationSteps: string[];
}

/**
 * Additional interfaces for completeness
 */
export interface LayerCompliance {
	layers: string[];
	violations: string[];
	complianceScore: number;
}

export interface ModuleInfo {
	name: string;
	path: string;
	cohesion: number;
	coupling: number;
	responsibility: string;
}

export interface DependencyMetrics {
	abstractness: number;
	instability: number;
	distance: number;
	efferentCoupling: number;
	afferentCoupling: number;
}

export interface TestCoverageInfo {
	overall: number;
	byFile: Map<string, number>;
	byFunction: Map<string, number>;
	uncoveredLines: number[];
}

export interface PerformanceMetric {
	name: string;
	value: number;
	unit: string;
	trend: 'improving' | 'stable' | 'degrading';
	threshold?: number;
}

/**
 * Manages intelligent code analysis and architecture understanding
 */
export class CodeAnalysisManager {
	private readonly config: Config;
	private readonly workingDirectory: string;
	private analysisCache: Map<string, FileAnalysis> = new Map();
	private lastFullAnalysis?: Date;
	private visitedPaths: Set<string> = new Set(); // Prevent circular directory traversal

	constructor(config: Config) {
		this.config = config;
		this.workingDirectory = config.workingDirectory;
		logger.info('CodeAnalysisManager initialized');
	}

	/**
	 * Performs comprehensive analysis of the entire codebase
	 */
	async analyzeCodebase(): Promise<ArchitectureAnalysis> {
		try {
			logger.info('Starting comprehensive codebase analysis');
			const startTime = Date.now();

			// Clear cache and reset state for fresh analysis
			this.analysisCache.clear();
			this.visitedPaths.clear();

			// Discover all code files
			const codeFiles = await this.discoverCodeFiles();
			logger.info(`Discovered ${codeFiles.length} code files for analysis`);

			if (codeFiles.length === 0) {
				logger.warn('No code files found for analysis');
				return this.createEmptyArchitectureAnalysis();
			}

			// Analyze individual files with concurrency control
			const fileAnalyses = await this.analyzeFilesWithConcurrency(codeFiles);
			logger.info(`Successfully analyzed ${fileAnalyses.length}/${codeFiles.length} files`);

			// Build comprehensive architecture analysis
			const architecture: ArchitectureAnalysis = {
				projectStructure: await this.analyzeProjectStructure(fileAnalyses),
				dependencyGraph: await this.buildDependencyGraph(fileAnalyses),
				codeMetrics: await this.calculateCodeMetrics(fileAnalyses),
				architecturalPatterns: await this.identifyArchitecturalPatterns(fileAnalyses),
				qualityGates: await this.evaluateQualityGates(fileAnalyses),
				improvementSuggestions: await this.generateImprovementSuggestions(fileAnalyses),
				testCoverage: await this.analyzeTestCoverage(),
				performanceMetrics: await this.gatherPerformanceMetrics()
			};

			this.lastFullAnalysis = new Date();
			const duration = Date.now() - startTime;
			logger.info(`Completed codebase analysis in ${duration}ms`);

			return architecture;
		} catch (error) {
			logger.error(`Failed to analyze codebase: ${error}`);
			throw new Error(`Codebase analysis failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Analyzes files with concurrency control to prevent memory issues
	 */
	private async analyzeFilesWithConcurrency(codeFiles: string[]): Promise<FileAnalysis[]> {
		const fileAnalyses: FileAnalysis[] = [];
		const batches = this.createBatches(codeFiles, MAX_CONCURRENT_ANALYSIS);

		for (const batch of batches) {
			const batchPromises = batch.map(async filePath => {
				try {
					const analysis = await this.analyzeFile(filePath);
					this.analysisCache.set(filePath, analysis);
					return analysis;
				} catch (error) {
					logger.warn(`Failed to analyze file ${filePath}: ${error}`);
					return null;
				}
			});

			const batchResults = await Promise.all(batchPromises);
			fileAnalyses.push(...batchResults.filter((result): result is FileAnalysis => result !== null));
		}

		return fileAnalyses;
	}

	/**
	 * Creates batches of items for controlled processing
	 */
	private createBatches<T>(items: T[], batchSize: number): T[][] {
		const batches: T[][] = [];
		for (let i = 0; i < items.length; i += batchSize) {
			batches.push(items.slice(i, i + batchSize));
		}
		return batches;
	}

	/**
	 * Creates an empty architecture analysis for edge cases
	 */
	private createEmptyArchitectureAnalysis(): ArchitectureAnalysis {
		return {
			projectStructure: {
				directories: [],
				filesByType: new Map(),
				layerCompliance: { layers: [], violations: [], complianceScore: 0 },
				moduleOrganization: []
			},
			dependencyGraph: {
				nodes: [],
				edges: [],
				circularDependencies: [],
				dependencyMetrics: {
					abstractness: 0,
					instability: 0,
					distance: 0,
					efferentCoupling: 0,
					afferentCoupling: 0
				}
			},
			codeMetrics: {
				totalLines: 0,
				totalFiles: 0,
				averageComplexity: 0,
				duplicatedLines: 0,
				technicalDebtHours: 0,
				maintainabilityScore: 0,
				testCoveragePercentage: 0,
				codeChurn: 0
			},
			architecturalPatterns: [],
			qualityGates: [],
			improvementSuggestions: [],
			testCoverage: {
				overall: 0,
				byFile: new Map(),
				byFunction: new Map(),
				uncoveredLines: []
			},
			performanceMetrics: []
		};
	}

	/**
	 * Analyzes a single file for structure, complexity, and quality metrics
	 */
	async analyzeFile(filePath: string): Promise<FileAnalysis> {
		try {
			const absolutePath = path.resolve(this.workingDirectory, filePath);
			const stats = await fs.stat(absolutePath);

			// Skip files that are too large to prevent memory issues
			if (stats.size > MAX_FILE_SIZE) {
				logger.warn(`Skipping large file ${filePath}: ${stats.size} bytes`);
				throw new Error(`File too large: ${stats.size} bytes`);
			}

			// Skip empty files
			if (stats.size === 0) {
				logger.debug(`Skipping empty file ${filePath}`);
				throw new Error('File is empty');
			}

			const content = await fs.readFile(absolutePath, 'utf-8');

			// Validate content is text (not binary)
			if (this.isBinaryContent(content)) {
				logger.debug(`Skipping binary file ${filePath}`);
				throw new Error('File appears to be binary');
			}

			const analysis: FileAnalysis = {
				filePath,
				extension: path.extname(filePath),
				lines: content.split('\n').length,
				size: stats.size,
				complexity: await this.calculateComplexity(content),
				dependencies: await this.extractDependencies(content),
				exports: await this.extractExports(content),
				functions: await this.extractFunctions(content),
				classes: await this.extractClasses(content),
				interfaces: await this.extractInterfaces(content),
				imports: await this.extractImportInfo(content),
				maintainabilityIndex: await this.calculateMaintainabilityIndex(content),
				technicalDebt: await this.identifyTechnicalDebt(content),
				lastModified: stats.mtime
			};

			logger.debug(`Analyzed file ${filePath}: ${analysis.lines} lines, complexity ${analysis.complexity}`);
			return analysis;
		}
