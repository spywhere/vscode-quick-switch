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
            "quick-switch.addProject", () => {
                this.quickSwitch.addProject();
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "quick-switch.switchProject", () => {
                this.quickSwitch.switchProject();
            }
        ));
        subscriptions.push(vscode.commands.registerCommand(
            "quick-switch.listProject", () => {
                this.quickSwitch.listProject();
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

interface ConfigurationStructure {
    schema: number;
    projects: string[];
}

interface ActionItem extends vscode.MessageItem {
    action: () => void;
}

interface ProjectItem extends vscode.QuickPickItem {
    index: number;
    path: string;
    action?: () => void;
}

class QuickSwitch {
    private projects: string[] = [];
    private statusItem: vscode.StatusBarItem;

    constructor(){
        this.statusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right
        );
        this.statusItem.command = "quick-switch.switchProject";
        this.statusItem.text = "$(repo-pull)";
        this.statusItem.tooltip = "Switch Project...";
        this.statusItem.hide();
        this.loadConfigurations();
    }

    dispose(){
        this.statusItem.dispose();
    }

    updateStatus(error?: Error){
        if (error) {
            this.statusItem.command = "quick-switch.reload";
            this.statusItem.text = "$(stop)";
            this.statusItem.tooltip = "Loading Error. Click to retry.";
        } else {
            this.statusItem.command = "quick-switch.switchProject";
            this.statusItem.text = "$(repo-pull)";
            this.statusItem.tooltip = "Switch Project...";
        }
    }

    loadConfigurations(){
        let configPath = this.getConfigPath();

        if (!fs.existsSync(configPath)) {
            this.projects = [];
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
                    this.projects = data.projects;
                }
            } catch (error) {
                console.error("Error while parsing configuration:", error);
                this.projects = [];
            }
            this.updateStatus();
            this.statusItem.show();
        });
    }

    saveConfigurations(){
        fs.writeFile(this.getConfigPath(), JSON.stringify({
            schema: 1,
            projects: this.projects
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

    pickProject(
        placeHolder: string,
        action: (project: ProjectItem) => void,
        ...extraItems: ProjectItem[]
    ){
        vscode.window.showQuickPick<ProjectItem>(
            this.projects.map<ProjectItem>((projectPath, index) => {
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

    addProject(force: boolean = false){
        let rootPath = vscode.workspace.rootPath;
        if (!rootPath) {
            vscode.window.showErrorMessage("Quick Switch: No project opened.");
            return;
        }
        if (!force && this.projects.indexOf(rootPath) >= 0) {
            this.showInformation("Quick Switch: Project already exists.", {
                title: "Add Anyway",
                action: () => {
                    this.addProject(true);
                }
            });
            return;
        }
        this.projects.push(rootPath);
        this.saveConfigurations();
        this.showInformation("Quick Switch: Project added.", {
            title: "Show Projects",
            action: () => {
                this.switchProject();
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
            description: "Add current project to the list",
            index: -1,
            path: "",
            action: () => {
                this.addProject();
            }
        });
    }

    listProject(){
        if (this.projects.length === 0) {
            this.showInformation("Quick Switch: No project available.", {
                title: "Add Current Project",
                action: () => {
                    this.addProject();
                }
            });
            return;
        }
        this.pickProject("Select a project to remove...", (project) => {
            this.projects.splice(project.index, 1);
            this.saveConfigurations();
            if (this.projects.length > 0) {
                this.listProject();
            }
        });
    }
}
