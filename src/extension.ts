"use strict";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
    let quickSwitch = new QuickSwitch();
    context.subscriptions.push(quickSwitch);
    context.subscriptions.push(new QuickSwitchController(quickSwitch));
}

class QuickSwitchController {
    private quickSwitch: QuickSwitch;
    private disposable: vscode.Disposable;
    private lastLine: number = undefined;

    constructor(quickSwitch: QuickSwitch){
        this.quickSwitch = quickSwitch;

        let subscriptions: vscode.Disposable[] = [];
        subscriptions.push(vscode.commands.registerCommand(
            "quick-switch.reload", () => {
                this.quickSwitch.loadConfigurations();
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "quick-switch.addWorkspace", () => {
                this.quickSwitch.addWorkspace();
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "quick-switch.addProject", () => {
                this.quickSwitch.addProject();
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "quick-switch.switchWorkspace", () => {
                this.quickSwitch.switchWorkspace();
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "quick-switch.switchProject", () => {
                this.quickSwitch.switchProject();
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "quick-switch.listWorkspace", () => {
                this.quickSwitch.listWorkspace();
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "quick-switch.listProject", () => {
                this.quickSwitch.listProject();
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "quick-switch.reorderProject", () => {
                this.quickSwitch.listProject({
                    reorder: true
                });
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "quick-switch.setStatusFormat", () => {
                this.quickSwitch.setStatusFormat();
            }
        ));
        vscode.workspace.onDidChangeConfiguration(() => {
            this.quickSwitch.loadConfigurations();
        }, this, subscriptions);

        this.disposable = vscode.Disposable.from(...subscriptions);
    }

    dispose(){
        this.disposable.dispose();
    }
}

interface Workspace {
    [project: string]: string[];
}

interface ConfigurationStructure {
    schema: number;
}

interface ConfigurationStructureV2 extends ConfigurationStructure {
    projects: string[];
    minimalStatus: boolean;
}

interface ConfigurationStructureV3 extends ConfigurationStructure {
    use: string;
    workspaces: Workspace;
    statusText: string;
}

interface ActionItem extends vscode.MessageItem {
    action: () => void;
}

interface WorkspaceItem extends vscode.QuickPickItem {
    name: string;
    action?: () => void;
}

interface ProjectItem extends vscode.QuickPickItem {
    index: number;
    path: string;
    action?: () => void;
}

class QuickSwitch {
    private timer: NodeJS.Timer;
    private currentWorkspace?: string = "default";
    private workspace?: Workspace = {
        default: []
    };
    private statusItem: vscode.StatusBarItem;
    private statusText? = "";
    private statusTooltip = (
        "Project: <basename:project>\n" +
        "Workspace: <workspace>\n" +
        "Click to switch project..."
    );

    constructor(){
        this.statusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right
        );
        this.statusItem.command = "quick-switch.switchProject";
        this.statusItem.text = "$(repo-pull)";
        this.statusItem.tooltip = "Switch Project...";
        this.statusItem.hide();
        this.timer = setInterval(() => {
            this.loadConfigurations();
        }, 60000);
        this.loadConfigurations();
    }

    dispose(){
        clearInterval(this.timer);
        this.statusItem.dispose();
    }

    updateStatus(error?: Error){
        let rootPath = vscode.workspace.rootPath || "";
        let workspaceName = this.currentWorkspace || "default";
        function parseMacro(expression?: string): string {
            if (!expression) {
                return "";
            }
            let [name, ...rest] = expression.split(":");
            let options = rest.join(":");
            if (name === "workspace") {
                return workspaceName;
            } else if (name === "project") {
                return rootPath;
            } else if (name === "basename") {
                return path.basename(parseMacro(options));
            } else if (name === "lower") {
                return parseMacro(options).toLowerCase();
            } else if (name === "upper") {
                return parseMacro(options).toUpperCase();
            }
            return "";
        }

        let text = this.statusText.replace(
            new RegExp("(\\\\?)<([^:>]+(:[^>]+)?)>", "g"),
            (match, escaped, expression) => {
                if (escaped) {
                    return match.substr(1);
                }
                return parseMacro(expression);
            }
        );

        let tooltip = this.statusTooltip.replace(
            new RegExp("(\\\\?)<([^:>]+(:[^>]+)?)>", "g"),
            (match, escaped, expression) => {
                if (escaped) {
                    return match.substr(1);
                }
                return parseMacro(expression);
            }
        );

        if (text) {
            text = " " + text.trim();
        }

        if (error) {
            this.statusItem.command = "quick-switch.reload";
            this.statusItem.text = `$(stop)${ text }`;
            this.statusItem.tooltip = "Loading Error. Click to retry.";
        } else {
            this.statusItem.command = "quick-switch.switchProject";
            this.statusItem.text = `$(repo-pull)${ text }`;
            this.statusItem.tooltip = tooltip;
        }
    }

    loadConfigurations(){
        let configPath = this.getConfigPath();

        if (!fs.existsSync(configPath)) {
            this.updateStatus();
            this.statusItem.show();
            return;
        }
        try {
            fs.accessSync(configPath, fs.constants.R_OK);
        } catch (error) {
            console.error("Error while accessing configuration:", error);
            this.updateStatus(error);
            this.statusItem.show();
            return;
        }
        fs.readFile(configPath, "utf-8", (error, content) => {
            if (error) {
                console.error("Error while loading configuration:", error);
                this.updateStatus(error);
                this.statusItem.show();
                return;
            }
            try {
                let data: ConfigurationStructure = JSON.parse(content);
                if (data.schema === 1) {
                    let schema = data as ConfigurationStructureV2;
                    if (schema.projects !== undefined) {
                        this.workspace = {
                            default: schema.projects
                        };
                    }
                    this.statusText = "";
                } else if (data.schema === 2) {
                    let schema = data as ConfigurationStructureV2;
                    if (schema.projects !== undefined) {
                        this.workspace = {
                            default: schema.projects
                        };
                    }
                    this.statusText = (
                        (
                            schema.minimalStatus === undefined ||
                            schema.minimalStatus
                        ) ? "" : "<basename:project>"
                    );
                } else if (data.schema === 3) {
                    let schema = data as ConfigurationStructureV3;
                    if (schema.workspaces !== undefined) {
                        this.workspace = schema.workspaces;
                    }
                    if (schema.statusText !== undefined) {
                        this.statusText = schema.statusText;
                    }
                }
                this.updateStatus();
            } catch (error) {
                console.error("Error while parsing configuration:", error);
                this.updateStatus(error);
            }
            this.statusItem.show();
        });
    }

    saveConfigurations(){
        fs.writeFile(this.getConfigPath(), JSON.stringify({
            schema: 3,
            use: this.currentWorkspace,
            workspaces: this.workspace,
            statusText: this.statusText
        }, undefined, 2), (error) => {
            if (!error) {
                return;
            }
            console.error("Error while saving configuration:", error);
        });
    }

    getConfigPath(){
        return path.join(
            process.env[
                os.type() === "Windows_NT" ? "USERPROFILE" : "HOME"
            ] || "",
            ".quick-switch"
        );
    }

    askValue(
        prompt: string,
        action: (value: string) => void,
        defaultValue?: string,
        validate?: (value: string) => string
    ){
        vscode.window.showInputBox({
            prompt: prompt,
            placeHolder: prompt,
            value: defaultValue,
            validateInput: validate
        }).then((value) => {
            if (!value) {
                return;
            }
            action(value);
        });
    }

    pickWorkspace(
        placeHolder: string,
        action: (workspace: WorkspaceItem) => void,
        ...extraItems: WorkspaceItem[]
    ){
        if (Object.keys(this.workspace || {}).length <= 0) {
            this.workspace = {
                default: []
            };
        }
        vscode.window.showQuickPick<WorkspaceItem>(
            Object.keys(this.workspace).map<WorkspaceItem>((workspaceName) => {
                let totalProject = this.workspace[workspaceName].length;
                return {
                    label: workspaceName,
                    description: `${
                        totalProject
                    } project${
                        totalProject > 1 ? "s" : ""
                    }`,
                    name: workspaceName
                }
            }
        ).concat(extraItems), {
            placeHolder: placeHolder
        }).then((item) => {
            if (!item) {
                return;
            }
            if (item.action) {
                item.action();
            } else {
                action(item);
            }
        });
    }

    pickProject(
        placeHolder: string,
        action: (project: ProjectItem) => void,
        ...extraItems: ProjectItem[]
    ){
        vscode.window.showQuickPick<ProjectItem>(
            (
                (this.workspace || {})[this.currentWorkspace || "default"] || []
            ).map<ProjectItem>((projectPath, index) => {
                return {
                    index: index,
                    label: path.basename(projectPath),
                    description: projectPath,
                    path: projectPath
                };
            }
        ).concat(extraItems), {
            placeHolder: placeHolder
        }).then((item) => {
            if (!item) {
                return;
            }
            if (item.action) {
                item.action();
            } else {
                action(item);
            }
        });
    }

    showInformation(message: string, ...actions: ActionItem[]){
        vscode.window.showInformationMessage<ActionItem>(
            message, { modal: false }, ...actions
        ).then((item) => {
            if (!item) {
                return;
            }
            item.action();
        });
    }

    showWarning(message: string, ...actions: ActionItem[]){
        vscode.window.showWarningMessage<ActionItem>(
            message, { modal: false }, ...actions
        ).then((item) => {
            if (!item) {
                return;
            }
            item.action();
        });
    }

    addWorkspace(forceValue?: string){
        let action = (value) => {
            if (
                !forceValue &&
                (this.workspace || {})[value]
            ) {
                this.showWarning("Quick Switch: Workspace already exists.", {
                    title: "Replace workspace",
                    action: () => {
                        this.addWorkspace(value);
                    }
                });
                return;
            }
            this.currentWorkspace = value;
            if (!this.workspace) {
                this.workspace = {};
            }
            this.workspace[value] = [];
            this.saveConfigurations();
            this.showInformation("Quick Switch: Workspace added.", {
                title: "Show Workspaces",
                action: () => {
                    this.switchWorkspace();
                }
            }, {
                title: "Add Current Project",
                action: () => {
                    this.addProject();
                }
            });
        };

        if (forceValue) {
            return action(forceValue);
        }

        this.askValue("Enter workspace name...", action, undefined, (value) => {
            if (new RegExp("^[a-z0-9-]+$").test(value)) {
                return "";
            }
            return (
                "Workspace name must be lowercase, " +
                "alphabet or numeric or - only."
            );
        });
    }

    addProject(force: boolean = false){
        let rootPath = vscode.workspace.rootPath;
        if (!rootPath) {
            vscode.window.showErrorMessage("Quick Switch: No project opened.");
            return;
        }
        if (
            !force && (
                (this.workspace || {})[this.currentWorkspace || "default"] || []
            ).indexOf(rootPath) >= 0
        ) {
            this.showInformation("Quick Switch: Project already exists.", {
                title: "Add Anyway",
                action: () => {
                    this.addProject(true);
                }
            });
            return;
        }
        if (!this.workspace) {
            this.workspace = {};
        }
        if (!this.workspace[this.currentWorkspace || "default"]) {
            this.workspace[this.currentWorkspace || "default"] = [];
        }
        this.workspace[this.currentWorkspace || "default"].push(rootPath);
        this.saveConfigurations();
        this.showInformation("Quick Switch: Project added.", {
            title: "Show Projects",
            action: () => {
                this.switchProject();
            }
        });
    }

    switchWorkspace(){
        this.pickWorkspace("Select a workspace to switch to...", (workspace) => {
            this.currentWorkspace = workspace.name;
            this.saveConfigurations();
        }, {
            label: "Create New Workspace...",
            description: "Create a new workspace",
            name: "",
            action: () => {
                this.addWorkspace();
            }
        });
    }

    switchProject(){
        this.pickProject("Select a project to switch to...", (project) => {
            vscode.commands.executeCommand(
                "vscode.openFolder", vscode.Uri.file(project.path)
            );
        }, {
            label: "Add Current Project...",
            description: `Add current project to "${
                this.currentWorkspace || "default"
            }" workspace`,
            index: -1,
            path: "",
            action: () => {
                this.addProject();
            }
        });
    }

    listWorkspace(){
        this.pickWorkspace("Select a workspace to remove...", (workspace) => {
            this.showWarning(
                `Are you sure to remove "${
                    workspace.name
                }" workspace? All ${
                    this.workspace[workspace.name].length
                } projects will also be removed.`,
                {
                    title: "Delete it all",
                    action: () => {
                        delete this.workspace[workspace.name];
                        this.saveConfigurations();
                        this.listWorkspace();
                    }
                }
            )
        })
    }

    listProject(options?: {
        reorder?: boolean
    }){
        let reorder = options && options.reorder;
        if (
            (
                (this.workspace || {})[this.currentWorkspace || "default"] || []
            ).length === 0
        ) {
            this.showInformation("Quick Switch: No project available.", {
                title: "Add Current Project",
                action: () => {
                    this.addProject();
                }
            });
            return;
        }
        this.pickProject(
            (
                reorder ?
                "Select a project to move up..." :
                "Select a project to remove..."
            ),
            (project) => {
                let selected = (
                    this.workspace[this.currentWorkspace || "default"] || []
                ).splice(project.index, 1);
                if (reorder) {
                    (
                        this.workspace[this.currentWorkspace || "default"] || []
                    ).splice(
                        Math.max(0, project.index - 1), 0, ...selected
                    );
                }
                this.saveConfigurations();
                if (
                    !reorder ||
                    (
                        this.workspace[this.currentWorkspace || "default"] || []
                    ).length > 0
                ) {
                    this.listProject(options);
                }
            }
        );
    }

    setStatusFormat(){
        this.askValue("Status format...", (value) => {
            this.statusText = value;
            this.updateStatus();
            this.saveConfigurations();
        }, this.statusText);
    }
}
