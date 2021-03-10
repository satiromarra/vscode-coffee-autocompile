/**
 * This file is part of the vscode-coffee-autocompile distribution.
 * Copyright (c) Satiro Marra.
 *
 * vscode-coffee-autocompile is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as
 * published by the Free Software Foundation, version 3.
 *
 * vscode-coffee-autocompile is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import * as vscode from 'vscode';
import * as _ from 'lodash';
import * as FSExtra from 'fs-extra';
import * as Path from 'path';
import CoffeeScript = require('coffeescript');
import uglifyJS = require('uglify-es');

interface CompilerResult {
	js: string;
	sourceMap?: any;
}

interface Config extends vscode.WorkspaceConfiguration {
	output?: string;
	compress?: boolean;
	bare?: boolean;
	header?: boolean;
	options?: any;
	inlineMap?: boolean;
	sourceMap?: boolean;
}

const COFFEE_EXT = ".coffee";
const COFFEE_SECTION = "coffeescript.autocompile";

class WSCoffeCompiler {
	private isReloadingConfig = false;
	private isDeactivating = false;
	private readConfig(ws: string): Config {
		let config: Config;
		if (this.isReloadingConfig) {
			return config;
		}
		this.isReloadingConfig = true;
		const resource = vscode.Uri.file(Path.join(
			ws,
			'.vscode',
			'settings.json'
		));
		try {
			config = vscode.workspace.getConfiguration(COFFEE_SECTION, resource) || <any>{};
		}
		finally {
			this.isReloadingConfig = false;
		}
		return config;
	}
	public constructor() {
		this.initialize();
	}
	public async initialize() { }

	public async onDidChangeConfiguration() { }

	public async onDidChangeWorkspaceFolders(added: ReadonlyArray<vscode.WorkspaceFolder>, removed?: ReadonlyArray<vscode.WorkspaceFolder>) { }

	public async onDidSaveTextDocument(e: vscode.TextDocument) {
		if (this.isDeactivating || this.isReloadingConfig) {
			return;
		}
		const RELATIVE_PATH = toRelativePath(e.fileName);
		if (false === RELATIVE_PATH) {
			return;
		}
		if (!e.fileName.trim().endsWith(COFFEE_EXT)) {
			return;
		}
		const rootDir = rootPath(e.fileName);
		let config: Config = this.readConfig(rootDir);
		if (!config) {
			return;
		}
		let params = getParams(e);
		if (!params) {
			params = {
				output: config.output,
				bare: config.bare,
				compress: config.compress,
				sourceMap: config.sourceMap,
				inlineMap: config.inlineMap,
				header: config.header
			};
		}

		let outputDir = '';
		let outputName = '';
		outputDir = params.output ? params.output : Path.dirname(e.fileName) + '/';
		outputDir = fixPath(outputDir);

		if (outputDir.trim().startsWith('$')) {
			outputDir = rootDir + outputDir.slice(1);
		}
		if (outputDir.trim().endsWith('.js')) {
			outputName = Path.basename(outputDir);
			outputDir = Path.dirname(outputDir);
		}
		if (outputDir.trim().startsWith('.')) {
			outputDir = Path.dirname(e.fileName) + '/' + outputDir;
		}
		if (!outputDir.trim().startsWith('/')) {
			outputDir = '/' + outputDir;
		}
		if (!outputDir.trim().endsWith('/')) {
			outputDir += '/';
		}
		if (!outputDir.trim().startsWith(rootDir)) {
			outputDir = rootDir + outputDir;
		}
		const FILE_DIR_OUTPUT = Path.resolve(outputDir);
		if (!FILE_DIR_OUTPUT.trim().startsWith(rootDir)) {
			showView('error', `Output Dir is not valid ${FILE_DIR_OUTPUT}`);
			return;
		}

		try {
			const FILE_NAME = Path.basename(e.fileName);
			const FILE_EXT = Path.extname(e.fileName);
			const OUT_FILE = Path.resolve(
				Path.join(
					FILE_DIR_OUTPUT,
					outputName ? outputName : Path.basename(FILE_NAME, FILE_EXT) + '.js',
				)
			);
			const OUT_FILE_NAME = Path.basename(OUT_FILE);

			const SOURCE_MAP_FILE = Path.resolve(
				Path.join(
					FILE_DIR_OUTPUT,
					OUT_FILE_NAME + '.map',
				)
			);
			const SOURCE_MAP_FILE_NAME = Path.basename(SOURCE_MAP_FILE);
			let source: string;
			let result: CompilerResult = CoffeeScript.compile(e.getText(), {
				bare: toBooleanValue(params.bare, true),
				header: toBooleanValue(params.header, false),
				inlineMap: toBooleanValue(params.inlineMap, false),
				sourceMap: toBooleanValue(params.sourceMap, false),
			});
			if (_.isString(result)) {
				source = result.toString();
			} else {
				source = result.js;
				if (result.sourceMap) {
					const GENERATED_MAP = result.sourceMap.generate({
						generatedFile: OUT_FILE_NAME,
						sourceFiles: [FILE_NAME]
					});
					if (GENERATED_MAP) {
						await writeFile(SOURCE_MAP_FILE, JSON.stringify(GENERATED_MAP));
					}
				}
			}

			let js = toStringValue(source);
			if (toBooleanValue(params.compress, false)) {
				js = uglifyJS.minify(js).code;
			}
			if (!params.inlineMap && params.sourceMap) {
				js += `

//# sourceMappingURL=${SOURCE_MAP_FILE_NAME}
//# sourceURL=coffeescript`;
			}
			await writeFile(OUT_FILE, js);
		}
		catch (e) {
			showView('error', `[CoffeeScript] ${toStringValue(e)}`);
		}
	}
	public async deactivate() {
		if (this.isDeactivating) {
			return;
		}
		this.isDeactivating = true;
		showView('info', 'Extension deactivated');
	}
}

function toRelativePath(path: string): string | false {
	path = fixPath(path);
	const WORKSPACE_DIR = fixPath(rootPath(path));

	if (!path.startsWith(WORKSPACE_DIR)) {
		return false;
	}

	let relativePath = path.substr(WORKSPACE_DIR.length);
	while (relativePath.startsWith('/')) {
		relativePath = relativePath.substr(1);
	}
	while (relativePath.endsWith('/')) {
		relativePath = relativePath.substr(0, relativePath.length - 1);
	}
	return relativePath;
}

function showView(type: string, message: string): void {
	switch (type) {
		case 'success':
			vscode.window.setStatusBarMessage(message, 5000);
			break;
		case 'info':
			vscode.window.showInformationMessage(message);
			break;
		case 'error':
			vscode.window.showErrorMessage(message);
			break;
		case 'warning':
			vscode.window.showWarningMessage(message);
			break;
	}
}

async function writeFile(filePath: string, content: string) {
	FSExtra.mkdirp(Path.dirname(filePath), async (error) => {
		if (error) {
			return showView('error', error.message);
		}
		FSExtra.writeFile(filePath, content, error => {
			if (error) {
				return showView('error', error.message);
			}
			showView('success', `Compiled coffee script to ${getPathInWorkspaces(filePath)}`);
		});
	});
}

function getPathInWorkspaces(filePath: string): string {
	let projectPath = Path.dirname(filePath);
	for (let p of vscode.workspace.workspaceFolders) {
		if (filePath.match(p.uri.path)) {
			projectPath = p.uri.path;
		}
	}
	let regex = new RegExp(`^${projectPath}(/|\\\\)?`);
	return filePath.replace(regex, '');
}

function getParams(textEditor: vscode.TextDocument) {
	let fline = textEditor.lineAt(0).text;
	if (fline.match(/^#!/)) {
		fline = textEditor.lineAt(1).text;
	}
	let [, paramString] = fline.match(/\s*#\s*(.*)/) || [];
	if (!paramString) {
		return {};
	}
	paramString = paramString.trim();
	let output = replacePlaceholders(getParam(paramString, 'out'), textEditor);
	let bare = toBooleanValue(getParam(paramString, 'bare'));
	let compress = toBooleanValue(getParam(paramString, 'compress'));
	let sourceMap = toBooleanValue(getParam(paramString, 'sourcemap'));
	let inlineMap = toBooleanValue(getParam(paramString, 'inlinemap'));
	let header = toBooleanValue(getParam(paramString, 'header'));
	return { output, bare, compress, sourceMap, inlineMap, header };
}

function replacePlaceholders(outPath: string, textEditor: vscode.TextDocument): string {
	let inFile = Path.basename(textEditor.fileName);
	let extname = Path.extname(inFile);
	let basename = Path.basename(inFile, extname);
	return outPath.replace(/\$1/g, basename).replace(/\$2/g, extname.substr(1));
}

function getParam(paramString: string, key: string): string {
	let regex = new RegExp(`${key}\s*:\s*([^,]+)`);
	let [, value] = paramString.match(regex) || [, ''];
	return value.trim();
}

function toBooleanValue(val: any, defaultVal = false): boolean {
	if (_.isString(val)) {
		val = val === 'true';
	}
	if (_.isBoolean(val)) {
		return val;
	}
	if (_.isNil(val)) {
		return !!defaultVal;
	}
	return !!val;
}

function toStringValue(val: any, defaultVal = ''): string {
	if (_.isString(val)) {
		return val;
	}
	if (_.isNil(val)) {
		return '' + defaultVal;
	}
	try {
		if (val instanceof Error) {
			return '' + val.message;
		}
		if (_.isFunction(val['toString'])) {
			return '' + val.toString();
		}
		if (_.isObject(val)) {
			return JSON.stringify(val);
		}
	} catch { }
	return '' + val;
}

function fixPath(path: string): string {
	return toStringValue(path).split(Path.sep).join('/');
}

function rootPath(d: string) {
	let projectPath = Path.dirname(d);
	for (let p of vscode.workspace.workspaceFolders) {
		if (d.trim().startsWith(p.uri.path)) {
			projectPath = p.uri.path;
		}
	}
	return Path.resolve(projectPath);
}

const WD: WSCoffeCompiler = new WSCoffeCompiler();


export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (e: vscode.TextDocument) => {
		WD.onDidSaveTextDocument(e);
	}));
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
		WD.onDidChangeConfiguration();
	}));
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders((e: vscode.WorkspaceFoldersChangeEvent) => {
		WD.onDidChangeWorkspaceFolders(e.added, e.removed);
	}));
}
export async function deactivate() {
	WD.deactivate();
}

