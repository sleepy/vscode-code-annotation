import * as vscode from 'vscode';
import * as path from 'path';
import fetch from 'node-fetch';
import peircedb = require("./peircedb")
import models = require("./models")

import {
    PopulateAPIReponse,
    PopulateAPIData,
    getActivePeirceFile
} from './peirce_api_calls'
import { getConfiguration } from './configuration';
import { getRelativePathForFileName } from './utils';
import { setDecorations } from './decoration/decoration';
import { Position, TextEditor, WebviewPanel } from 'vscode';
import { privateEncrypt } from 'crypto';
import { cpuUsage } from 'process';
import { createReadStream } from 'fs';
import { cursorTo } from 'readline';
import { EINPROGRESS } from 'constants';

const getIconPathFromType = (type: string, theme: string): string => {
    return path.join(__filename, '..', '..', 'resources', theme, type.toLowerCase() + '.svg');
};

const getIconPath = (status: string): any => {
    const termType = (status === 'pending') ? 'todo' : 'check';
    return {
        light: getIconPathFromType(termType, 'light'),
        dark: getIconPathFromType(termType, 'dark')
    };
};

const getContextValue = (status: string): string => {
    return (status === 'pending') ? '$PendingTerm' : '$CompleteTerm';
};

const createTermItem = (term: models.Term): TermItem => {

    let details : TermItem[] = [];
    if (term.interpretation != null)
        details = [new TermItem(`Current interpretation: ${term.interpretation.label}`)]; 
    else
        details = [new TermItem(`Current interpretation: No interpretation provided`)];
    details.push(new TermItem(`Checked interpretation: ${term.text}`));
    details.push(new TermItem(`Type: ${term.node_type}`));
    details.push(new TermItem(`Error Message: ${term.error}`));
    let termItem = new TermItem(`${term.codeSnippet}`, details, term.id.toString());
    console.log('NOTE ITEM ID : ' + term.id.toString())
    if (termItem.id) {
        termItem.command = new OpenTermCommand(termItem.id);
    }
    if (details) {
        // If details isn't undefined, set the command to the same as the parent
        details[0].command = termItem.command;
    }
    termItem.tooltip = term.text;
    termItem.contextValue = getContextValue(term.status);
    termItem.iconPath = getIconPath(term.status);

    return termItem;
};

const createConsTermItem = (cons: models.Constructor): TermItem => {
    console.log(cons.interpretation)
    let details : TermItem[] = [];
    if (cons.interpretation != null)
        details = [new TermItem(`Current interpretation: ${cons.interpretation.label}`)]; 
    else
        details = [new TermItem(`Current interpretation: No interpretation provided`)];
    details.push(new TermItem(`Type: ${cons.node_type}`));
    details.push(new TermItem(`Name: ${cons.name}`));
    let termItem = new TermItem(`${cons.name}`, details, cons.id.toString());
    if (termItem.id) {
        termItem.command = new OpenTermCommand(termItem.id);
    }
    if (details) {
        // If details isn't undefined, set the command to the same as the parent
        details[0].command = termItem.command;
    }
    termItem.tooltip = cons.name;
    termItem.contextValue = getContextValue(cons.status);
    termItem.iconPath = getIconPath(cons.status);

    return termItem;
};

const createFunctionItem = (cons: models.FunctionItem): TermItem => {
    console.log(cons.interpretation)
    let details : TermItem[] = [];
    if (cons.interpretation != null)
        details = [new TermItem(`Current interpretation: ${cons.interpretation.label}`)]; 
    else
        details = [new TermItem(`Current interpretation: No interpretation provided`)];
    details.push(new TermItem(`Type: ${cons.node_type}`));
    details.push(new TermItem(`Name: ${cons.name}`));
    let termItem = new TermItem(`${cons.name}`, details, cons.id.toString());
    if (termItem.id) {
        termItem.command = new OpenTermCommand(termItem.id);
    }
    if (details) {
        // If details isn't undefined, set the command to the same as the parent
        details[0].command = termItem.command;
    }
    termItem.tooltip = cons.name;
    termItem.contextValue = getContextValue(cons.status);
    termItem.iconPath = getIconPath(cons.status);

    return termItem;
};

export class InfoView {
    private webviewPanel!: WebviewPanel;

    private getActiveCursorLocation(): Position | null {
        if (vscode.window.activeTextEditor)
            return vscode.window.activeTextEditor.selection.active;
        else
            return null;
    }

    getHoveredTerms() : models.Term[] {            
        let hovered_terms : models.Term[] = [];
        let terms = peircedb.getTerms();
        terms.forEach(term => {
            if (this.isHoveredTerm(term)) 
                hovered_terms.push(term);
        });
        return hovered_terms;
    }

    
    async createInterpretation(termIsIdentifier : boolean, node_type : string) : Promise<models.Interpretation | null> {

        console.log('going?')
        let interpretations : vscode.QuickPickItem[] = [
            { label: "Duration" },
            { label: "Time" },
            { label: "Scalar"},
            { label: "Time Transform"},
            { label: "Displacement1D"},
            { label: "Position1D"},
            { label: "Geom1D Transform"},
            { label: "Displacement3D"},
            { label: "Position3D"},
            { label: "Orientation3D"},
            { label: "Rotation3D"},
            { label: "Pose3D"},
            { label: "Geom3D Transform"},
            { label: "TimeStamped Pose3D"},
            { label: "TimeStamped Geom3D Transform"},
            { label: "TimeSeries Value"}
        ];

        if(termIsIdentifier){
            interpretations.push({label : "Create a Time Series"})
        }



        const interp = await vscode.window.showQuickPick(interpretations);
        if (interp === undefined) {
            return null
        }
        let name = "<identifier>";

        // If the following is true (the AST node is an identifier)
        // Peirce will not prompt for a name, so we won't ask for one.
        if (!termIsIdentifier) {
            let pickedName = await vscode.window.showInputBox({ placeHolder: 'Name of interpretation?' });
            if (pickedName === undefined || pickedName == "")  {
                return null
            }
            name = pickedName;
        }
        // get the current order in which terms have been created, then increment the global interp number
        let currInterpretationNumber = peircedb.getCurrentInterpretationNumber();
        peircedb.setCurrentInterpretationNumber(currInterpretationNumber+1)
        console.log("GETTING DB TERMS....");
        console.log(peircedb.getTerms());
        console.log("GETTING SPACES...");
        console.log(peircedb.getGeom1DSpaces());
        console.log(peircedb.getGeom3DSpaces());
        console.log(peircedb.getTimeSpaces());
        if(interp.label == "Duration"){

            let spaces = peircedb.getTimeSpaces();
            console.log(spaces);
            let i = 0;
            const space = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select a coordinate space'
            });
            console.log("space quick pick")
            console.log(space);
            if (space === undefined) {
                return null
            }

            let value = await vscode.window.showInputBox({ placeHolder: 'Value?' });
            if (value === undefined || Number(value) == NaN)  {
                return null
            }

            let label = `${name} ${interp.label}(${space.label},${value})`
            if (termIsIdentifier) {
                label = `${interp.label}(${space.label},${value})`
            }
            let interpretation : models.Duration = {
                label: label,
                name: name,
                interp_type: interp.label,
                space: space,
                value: [+value],
                node_type: "undefined",//term.node_type,
                order_created: currInterpretationNumber
            }
            return interpretation
            
        }
        else if(interp.label == "Time"){

            let spaces = peircedb.getTimeSpaces();
            console.log(spaces);
            let i = 0;
            const space = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select a coordinate space'
            });
            console.log("space quick pick")
            console.log(space);
            if (space === undefined) {
                return null;
            }

            let value = await vscode.window.showInputBox({ placeHolder: 'Value?' });
            if (value === undefined || Number(value) == NaN)  {
                return null;
            }

            let label = `${name} ${interp.label}(${space.label},${value})`
            if (termIsIdentifier) {
                label = `${interp.label}(${space.label},${value})`
            }

            let interpretation : models.Time = {
                label: label,
                name: name,
                interp_type: interp.label,
                space: space,
                value: [+value],
                node_type: "term.node_type",
                order_created: currInterpretationNumber
            }
            return interpretation
        }
        else if(interp.label == "Scalar"){

            let value = await vscode.window.showInputBox({ placeHolder: 'Value?' });
            if (value === undefined || Number(value) == NaN)  {
                return null;
            }

            let label = `${name} ${interp.label}(${value})`
            if (termIsIdentifier) {
                label = `${interp.label}(${value})`
            }

            let interpretation : models.Scalar = {
                label: label,
                name: name,
                interp_type: interp.label,
                value: [+value],
                node_type: "term.node_type",
                order_created: currInterpretationNumber
            }
            return interpretation
        }
        else if(interp.label == "Time Transform"){

            let spaces = peircedb.getTimeSpaces();
            console.log(spaces);
            let i = 0;
            const domain = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select Domain Space'
            });
            console.log("space quick pick")
            console.log(domain);
            if (domain === undefined) {
                return null;
            }
            console.log(spaces);
            const codomain = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select Codomain Space'
            });
            console.log("space quick pick")
            console.log(codomain);
            if (codomain === undefined) {
                return null;
            }
            let label = `${name} ${interp.label}(${domain.label},${codomain.label})`
            if (termIsIdentifier) {
                label = `${interp.label}(${domain.label},${codomain.label})`
            }


            let interpretation : models.TimeTransform = {
                label: label,
                name: name,
                interp_type: interp.label,
                domain: domain,
                codomain: codomain,
                node_type: "term.node_type",
                order_created: currInterpretationNumber
            }
            return interpretation
        }
        else if(interp.label == "Displacement1D"){

            let spaces = peircedb.getGeom1DSpaces();
            console.log(spaces);
            let i = 0;
            const space = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select a coordinate space'
            });
            console.log("space quick pick")
            console.log(space);
            if (space === undefined) {
                return null;
            }

            let value = await vscode.window.showInputBox({ placeHolder: 'Value?' });
            if (value === undefined || Number(value) == NaN)  {
                return null;
            }

            let label = `${name} ${interp.label}(${space.label},${value})`
            if (termIsIdentifier) {
                label = `${interp.label}(${space.label},${value})`
            }

            let interpretation : models.Displacement1D = {
                label: label,
                name: name,
                interp_type: interp.label,
                space: space,
                value: [+value],
                node_type: "term.node_type",
                order_created: currInterpretationNumber
            }
            return interpretation
        }
        else if(interp.label == "Position1D"){

            let spaces = peircedb.getGeom1DSpaces();
            console.log(spaces);
            let i = 0;
            const space = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select a coordinate space'
            });
            console.log("space quick pick")
            console.log(space);
            if (space === undefined) {
                return null;
            }

            let value = await vscode.window.showInputBox({ placeHolder: 'Value?' });
            if (value === undefined || Number(value) == NaN)  {
                return null;
            }

            let label = `${name} ${interp.label}(${space.label},${value})`
            if (termIsIdentifier) {
                label = `${interp.label}(${space.label},${value})`
            }

            let interpretation : models.Position1D = {
                label: label,
                name: name,
                interp_type: interp.label,
                space: space,
                value: [+value],
                node_type: "term.node_type",
                order_created: currInterpretationNumber
            }
            return interpretation
        }
        else if(interp.label == "Geom1D Transform"){
            
            let spaces = peircedb.getGeom1DSpaces();
            console.log(spaces);
            let i = 0;
            const domain = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select Domain Space'
            });
            console.log("space quick pick")
            console.log(domain);
            if (domain === undefined) {
                return null;
            }
            console.log(spaces);
            const codomain = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select Codomain Space'
            });
            console.log("space quick pick")
            console.log(codomain);
            if (codomain === undefined) {
                return null;
            }
            let label = `${name} ${interp.label}(${domain.label},${codomain.label})`
            if (termIsIdentifier) {
                label = `${interp.label}(${domain.label},${codomain.label})`
            }


            let interpretation : models.Geom1DTransform = {
                label: label,
                name: name,
                interp_type: interp.label,
                domain: domain,
                codomain: codomain,
                node_type: "term.node_type",
                order_created: currInterpretationNumber
            }
            return interpretation
        }
        else if(interp.label == "Displacement3D"){

            let spaces = peircedb.getGeom3DSpaces();
            console.log(spaces);
            let i = 0;
            const space = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select a coordinate space'
            });
            console.log("space quick pick")
            console.log(space);
            if (space === undefined) {
                return null;
            }

            let value0 = await vscode.window.showInputBox({ placeHolder: 'Value at index 0?' });
            if (value0 === undefined || Number(value0) == NaN)  {
                return null;
            }
            let value1 = await vscode.window.showInputBox({ placeHolder: 'Value at index 1?' });
            if (value1 === undefined || Number(value1) == NaN)  {
                return null;
            }
            let value2 = await vscode.window.showInputBox({ placeHolder: 'Value at index 2?' });
            if (value2 === undefined || Number(value2) == NaN)  {
                return null;
            }

            let label = `${name} ${interp.label}(${space.label},${value0},${value1},${value2})`
            if (termIsIdentifier) {
                label = `${interp.label}(${space.label},${value0},${value1},${value2})`
            }

            let interpretation : models.Displacement3D = {
                label: label,
                name: name,
                interp_type: interp.label,
                space: space,
                value: [+value0,+value1,+value2],
                node_type: "term.node_type",
                order_created: currInterpretationNumber
            }
            return interpretation
        }
        else if(interp.label == "Position3D"){

            let spaces = peircedb.getGeom3DSpaces();
            console.log(spaces);
            let i = 0;
            const space = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select a coordinate space'
            });
            console.log("space quick pick")
            console.log(space);
            if (space === undefined) {
                return null;
            }


            let value0 = await vscode.window.showInputBox({ placeHolder: 'Value at index 0?' });
            if (value0 === undefined || Number(value0) == NaN)  {
                return null;
            }
            let value1 = await vscode.window.showInputBox({ placeHolder: 'Value at index 1?' });
            if (value1 === undefined || Number(value1) == NaN)  {
                return null;
            }
            let value2 = await vscode.window.showInputBox({ placeHolder: 'Value at index 2?' });
            if (value2 === undefined || Number(value2) == NaN)  {
                return null;
            }

            let label = `${name} ${interp.label}(${space.label},${value0},${value1},${value2})`
            if (termIsIdentifier) {
                label = `${interp.label}(${space.label},${value0},${value1},${value2})`
            }

            let interpretation : models.Position3D = {
                label: label,
                name: name,
                interp_type: interp.label,
                space: space,
                value: [+value0,+value1,+value2],
                node_type: "term.node_type",
                order_created: currInterpretationNumber
            }
            return interpretation
        }
        else if(interp.label == "Orientation3D"){

            let spaces = peircedb.getGeom3DSpaces();
            console.log(spaces);
            let i = 0;
            const space = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select a coordinate space'
            });
            console.log("space quick pick")
            console.log(space);
            if (space === undefined) {
                return null;
            }


            let value0 = await vscode.window.showInputBox({ placeHolder: 'Value at index 0?' });
            if (value0 === undefined || Number(value0) == NaN)  {
                return null;
            }
            let value1 = await vscode.window.showInputBox({ placeHolder: 'Value at index 1?' });
            if (value1 === undefined || Number(value1) == NaN)  {
                return null;
            }
            let value2 = await vscode.window.showInputBox({ placeHolder: 'Value at index 2?' });
            if (value2 === undefined || Number(value2) == NaN)  {
                return null;
            }
            let value3 = await vscode.window.showInputBox({ placeHolder: 'Value at index 3?' });
            if (value3 === undefined || Number(value3) == NaN)  {
                return null;
            }
            if (!node_type.includes("R4")){
                let value4 = await vscode.window.showInputBox({ placeHolder: 'Value at index 4?' });
                if (value4 === undefined || Number(value4) == NaN)  {
                    return null;
                }
                let value5 = await vscode.window.showInputBox({ placeHolder: 'Value at index 5?' });
                if (value5 === undefined || Number(value5) == NaN)  {
                    return null;
                }

                let value6 = await vscode.window.showInputBox({ placeHolder: 'Value at index 6?' });
                if (value6 === undefined || Number(value6) == NaN)  {
                    return null;
                }
                let value7 = await vscode.window.showInputBox({ placeHolder: 'Value at index 7?' });
                if (value7 === undefined || Number(value7) == NaN)  {
                    return null;
                }
                let value8 = await vscode.window.showInputBox({ placeHolder: 'Value at index 8?' });
                if (value8 === undefined || Number(value8) == NaN)  {
                    return null;
                }

                let label = `${name} ${interp.label}(${space.label},${value0},${value1},${value2})`
                if (termIsIdentifier) {
                    label = `${interp.label}(${space.label},${value0},${value1},${value2})`
                }

                let interpretation : models.Orientation3D = {
                    label: label,
                    name: name,
                    interp_type: interp.label,
                    space: space,
                    value: [+value0,+value1,+value2,+value3,+value4,+value5,+value6,+value7,+value8],
                    node_type: "term.node_type",
                    order_created: currInterpretationNumber
                }
                return interpretation
            }
            else{

                let label = `${name} ${interp.label}(${space.label},${value0},${value1},${value2})`
                if (termIsIdentifier) {
                    label = `${interp.label}(${space.label},${value0},${value1},${value2})`
                }

                let interpretation : models.Orientation3D = {
                    label: label,
                    name: name,
                    interp_type: interp.label,
                    space: space,
                    value: [+value0,+value1,+value2,+value3],
                    node_type: "term.node_type",
                    order_created: currInterpretationNumber
                }
                return interpretation
            }
        }
        else if(interp.label == "Rotation3D"){

            let spaces = peircedb.getGeom3DSpaces();
            console.log(spaces);
            let i = 0;
            const space = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select a coordinate space'
            });
            console.log("space quick pick")
            console.log(space);
            if (space === undefined) {
                return null;
            }


            let value0 = await vscode.window.showInputBox({ placeHolder: 'Value at index 0?' });
            if (value0 === undefined || Number(value0) == NaN)  {
                return null;
            }
            let value1 = await vscode.window.showInputBox({ placeHolder: 'Value at index 1?' });
            if (value1 === undefined || Number(value1) == NaN)  {
                return null;
            }
            let value2 = await vscode.window.showInputBox({ placeHolder: 'Value at index 2?' });
            if (value2 === undefined || Number(value2) == NaN)  {
                return null;
            }

            let value3 = await vscode.window.showInputBox({ placeHolder: 'Value at index 3?' });
            if (value3 === undefined || Number(value3) == NaN)  {
                return null;
            }
            if (!node_type.includes("R4")){
                let value4 = await vscode.window.showInputBox({ placeHolder: 'Value at index 4?' });
                if (value4 === undefined || Number(value4) == NaN)  {
                    return null;
                }
                let value5 = await vscode.window.showInputBox({ placeHolder: 'Value at index 5?' });
                if (value5 === undefined || Number(value5) == NaN)  {
                    return null;
                }

                let value6 = await vscode.window.showInputBox({ placeHolder: 'Value at index 6?' });
                if (value6 === undefined || Number(value6) == NaN)  {
                    return null;
                }
                let value7 = await vscode.window.showInputBox({ placeHolder: 'Value at index 7?' });
                if (value7 === undefined || Number(value7) == NaN)  {
                    return null;
                }
                let value8 = await vscode.window.showInputBox({ placeHolder: 'Value at index 8?' });
                if (value8 === undefined || Number(value8) == NaN)  {
                    return null;
                }

                let label = `${name} ${interp.label}(${space.label},${value0},${value1},${value2})`
                if (termIsIdentifier) {
                    label = `${interp.label}(${space.label},${value0},${value1},${value2})`
                }

                let interpretation : models.Rotation3D = {
                    label: label,
                    name: name,
                    interp_type: interp.label,
                    space: space,
                    value: [+value0,+value1,+value2,+value3,+value4,+value5,+value6,+value7,+value8],
                    node_type: "term.node_type",
                    order_created: currInterpretationNumber
                }
                return interpretation
            }
            else{

                let label = `${name} ${interp.label}(${space.label},${value0},${value1},${value2})`
                if (termIsIdentifier) {
                    label = `${interp.label}(${space.label},${value0},${value1},${value2})`
                }

                let interpretation : models.Rotation3D = {
                    label: label,
                    name: name,
                    interp_type: interp.label,
                    space: space,
                    value: [+value0,+value1,+value2,+value3],
                    node_type: "term.node_type",
                    order_created: currInterpretationNumber
                }
                return interpretation
            }
        }
        else if(interp.label == "Pose3D"){

            let spaces = peircedb.getGeom3DSpaces();
            console.log(spaces);
            let i = 0;
            const space = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select a coordinate space'
            });
            console.log("space quick pick")
            console.log(space);
            if (space === undefined) {
                return null;
            }


            let ortvalue0 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 0?' });
            if (ortvalue0 === undefined || Number(ortvalue0) == NaN)  {
                return null;
            }
            let ortvalue1 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 1?' });
            if (ortvalue1 === undefined || Number(ortvalue1) == NaN)  {
                return null;
            }
            let ortvalue2 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 2?' });
            if (ortvalue2 === undefined || Number(ortvalue2) == NaN)  {
                return null;
            }

            let ortvalue3 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 3?' });
            if (ortvalue3 === undefined || Number(ortvalue3) == NaN)  {
                return null;
            }
            let ortvalue4 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 4?' });
            if (ortvalue4 === undefined || Number(ortvalue4) == NaN)  {
                return null;
            }
            let ortvalue5 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 5?' });
            if (ortvalue5 === undefined || Number(ortvalue5) == NaN)  {
                return null;
            }

            let ortvalue6 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 6?' });
            if (ortvalue6 === undefined || Number(ortvalue6) == NaN)  {
                return null;
            }
            let ortvalue7 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 7?' });
            if (ortvalue7 === undefined || Number(ortvalue7) == NaN)  {
                return null;
            }
            let ortvalue8 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 8?' });
            if (ortvalue8 === undefined || Number(ortvalue8) == NaN)  {
                return null;
            }

            let posvalue0 = await vscode.window.showInputBox({ placeHolder: 'Position Value at index 0?' });
            if (posvalue0 === undefined || Number(posvalue0) == NaN)  {
                return null;
            }
            let posvalue1 = await vscode.window.showInputBox({ placeHolder: 'Position Value at index 1?' });
            if (posvalue1 === undefined || Number(posvalue1) == NaN)  {
                return null;
            }
            let posvalue2 = await vscode.window.showInputBox({ placeHolder: 'Position Value at index 2?' });
            if (posvalue2 === undefined || Number(posvalue2) == NaN)  {
                return null;
            }

            let label = `${name} ${interp.label}(${space.label},orientation,position)`
            if (termIsIdentifier) {
                label = `${interp.label}(${space.label},orientation,position)`
            }

            let interpretation : models.Pose3D = {
                label: label,
                name: name,
                interp_type: interp.label,
                space: space,
                value: [+ortvalue0,+ortvalue1,+ortvalue2,+ortvalue3,+ortvalue4,+ortvalue5,+ortvalue6,+ortvalue7,+ortvalue8,+posvalue0,+posvalue1,+posvalue2],
                node_type: "term.node_type",
                order_created: currInterpretationNumber
            }
            return interpretation
        }
        else if(interp.label == "Geom3D Transform"){
            
            let spaces = peircedb.getGeom3DSpaces();
            console.log(spaces);
            let i = 0;
            const domain = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select Domain Space'
            });
            console.log("space quick pick")
            console.log(domain);
            if (domain === undefined) {
                return null;
            }
            console.log(spaces);
            const codomain = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select Codomain Space'
            });
            console.log("space quick pick")
            console.log(codomain);
            if (codomain === undefined) {
                return null;
            }
            let label = `${name} ${interp.label}(${domain.label},${codomain.label})`
            if (termIsIdentifier) {
                label = `${interp.label}(${domain.label},${codomain.label})`
            }


            let interpretation : models.Geom3DTransform = {
                label: label,
                name: name,
                interp_type: interp.label,
                domain: domain,
                codomain: codomain,
                node_type: "term.node_type",
                order_created: currInterpretationNumber
            }
            return interpretation
        }
        else if(interp.label == "TimeStamped Pose3D"){
            
            let time_spaces = peircedb.getTimeSpaces();
            console.log(time_spaces);
            const time_space = await vscode.window.showQuickPick(time_spaces, {
                placeHolder: 'Select a coordinate space'
            });
            console.log("space quick pick")
            console.log(time_space);
            if (time_space === undefined) {
                return null;
            }

            let value = await vscode.window.showInputBox({ placeHolder: 'Value?' });
            if (value === undefined || Number(value) == NaN)  {
                return null;
            }

            let time_label = `${name} ${interp.label}(${time_space.label},${value})`
            if (termIsIdentifier) {
                time_label = `${interp.label}(${time_space.label},${value})`
            }

            let time_ : models.Time = {
                label: time_label,
                name: name,
                interp_type: interp.label,
                space: time_space,
                value: [+value],
                node_type: "term.node_type",
                order_created: currInterpretationNumber,
            }


            let spaces = peircedb.getGeom3DSpaces();
            console.log(spaces);
            let i = 0;
            const space = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select a coordinate space'
            });
            console.log("space quick pick")
            console.log(space);
            if (space === undefined) {
                return null;
            }


            let ortvalue0 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 0?' });
            if (ortvalue0 === undefined || Number(ortvalue0) == NaN)  {
                return null;
            }
            let ortvalue1 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 1?' });
            if (ortvalue1 === undefined || Number(ortvalue1) == NaN)  {
                return null;
            }
            let ortvalue2 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 2?' });
            if (ortvalue2 === undefined || Number(ortvalue2) == NaN)  {
                return null;
            }

            let ortvalue3 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 3?' });
            if (ortvalue3 === undefined || Number(ortvalue3) == NaN)  {
                return null;
            }
            let ortvalue4 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 4?' });
            if (ortvalue4 === undefined || Number(ortvalue4) == NaN)  {
                return null;
            }
            let ortvalue5 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 5?' });
            if (ortvalue5 === undefined || Number(ortvalue5) == NaN)  {
                return null;
            }

            let ortvalue6 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 6?' });
            if (ortvalue6 === undefined || Number(ortvalue6) == NaN)  {
                return null;
            }
            let ortvalue7 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 7?' });
            if (ortvalue7 === undefined || Number(ortvalue7) == NaN)  {
                return null;
            }
            let ortvalue8 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 8?' });
            if (ortvalue8 === undefined || Number(ortvalue8) == NaN)  {
                return null;
            }

            let posvalue0 = await vscode.window.showInputBox({ placeHolder: 'Position Value at index 0?' });
            if (posvalue0 === undefined || Number(posvalue0) == NaN)  {
                return null;
            }
            let posvalue1 = await vscode.window.showInputBox({ placeHolder: 'Position Value at index 1?' });
            if (posvalue1 === undefined || Number(posvalue1) == NaN)  {
                return null;
            }
            let posvalue2 = await vscode.window.showInputBox({ placeHolder: 'Position Value at index 2?' });
            if (posvalue2 === undefined || Number(posvalue2) == NaN)  {
                return null;
            }

            let label = `${name} ${interp.label}(${space.label},orientation,position)`
            if (termIsIdentifier) {
                label = `${interp.label}(${space.label},orientation,position)`
            }

            let pose3d_ : models.Pose3D = {
                label: label,
                name: name,
                interp_type: interp.label,
                space: space,
                value: [+ortvalue0,+ortvalue1,+ortvalue2,+ortvalue3,+ortvalue4,+ortvalue5,+ortvalue6,+ortvalue7,+ortvalue8,+posvalue0,+posvalue1,+posvalue2],
                node_type: "term.node_type",
                order_created: currInterpretationNumber+1,
            }

            let interpretation : models.TimeStampedPose3D = {
                label: "",
                name: name,
                interp_type: interp.label,
                timestamp: time_,
                value: pose3d_,
                series_name: null,
                node_type: "term.node_type",
                order_created: currInterpretationNumber+2,
            }
            peircedb.setCurrentInterpretationNumber(currInterpretationNumber+3);
            return interpretation
        }
        else if(interp.label == "TimeStamped Geom3D Transform"){

            let time_spaces = peircedb.getTimeSpaces();
            console.log(time_spaces);
            const time_space = await vscode.window.showQuickPick(time_spaces, {
                placeHolder: 'Select a coordinate space'
            });
            console.log("space quick pick")
            console.log(time_space);
            if (time_space === undefined) {
                return null;
            }

            let value = await vscode.window.showInputBox({ placeHolder: 'Value?' });
            if (value === undefined || Number(value) == NaN)  {
                return null;
            }

            let time_label = `${name} ${interp.label}(${time_space.label},${value})`
            if (termIsIdentifier) {
                time_label = `${interp.label}(${time_space.label},${value})`
            }

            let time_ : models.Time = {
                label: time_label,
                name: name,
                interp_type: interp.label,
                space: time_space,
                value: [+value],
                node_type: "term.node_type",
                order_created: currInterpretationNumber,
            }

            let spaces = peircedb.getGeom3DSpaces();
            console.log(spaces);
            let i = 0;
            const domain = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select Domain Space'
            });
            console.log("space quick pick")
            console.log(domain);
            if (domain === undefined) {
                return null;
            }
            console.log(spaces);
            const codomain = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select Codomain Space'
            });
            console.log("space quick pick")
            console.log(codomain);
            if (codomain === undefined) {
                return null;
            }
            let label = `${name} ${interp.label}(${domain.label},${codomain.label})`
            if (termIsIdentifier) {
                label = `${interp.label}(${domain.label},${codomain.label})`
            }


            let geom3d_transform : models.Geom3DTransform = {
                label: label,
                name: name,
                interp_type: "Pose3D",
                domain: domain,
                codomain: codomain,
                node_type: "term.node_type",
                order_created: currInterpretationNumber+1,
            }

            let interpretation : models.TimeStampedGeom3DTransform = {
                label: "",
                name: name,
                interp_type: interp.label,
                timestamp: time_,
                value: geom3d_transform,
                series_name: null,
                node_type: "term.node_type",
                order_created: currInterpretationNumber+2,
            }
            peircedb.setCurrentInterpretationNumber(currInterpretationNumber+3);

            return interpretation
        }
        else if(interp.label == "TimeSeries Value"){
            let all_series = peircedb.getTimeSeries()
            let options = all_series.map((ele) => {
                return { label:ele.name};
            })
            let chosen_series = await vscode.window.showQuickPick(
                options
            );
            if(chosen_series == null)
                return null

            
            let time_series = all_series[0]

            for(let ts in all_series){
                time_series = all_series[ts]
                if(time_series.name==chosen_series.label)
                    break
            }
            
            let latest_or_value = await vscode.window.showQuickPick(
                [
                    {label:"Get Latest Value from Time Series"},
                    {label:"Provide Specific Time"}
                ]
            );

            if(latest_or_value == null)
                return null

            if(latest_or_value.label == "Get Latest Value from Time Series"){
                let interpretation : models.SeriesIndex = {
                    label: "",
                    name: "",
                    interp_type: interp.label,
                    node_type: "term.node_type",
                    time_value: null,
                    time_series: time_series,
                    order_created: currInterpretationNumber,
                }
                peircedb.setCurrentInterpretationNumber(currInterpretationNumber+1);
                return interpretation
            }
            else{
                
                let value0 = await vscode.window.showInputBox({ placeHolder: 'Enter value of Time Series Index : ' });
                if (value0 === undefined || Number(value0) == NaN)  {
                    return null;
                }

                let value : number = Number(value0)

                let interpretation : models.SeriesIndex = {
                    label: "",
                    name: "",
                    interp_type: interp.label,
                    node_type: "term.node_type",
                    time_value: value,
                    time_series: time_series,
                    order_created: currInterpretationNumber,
                }
                peircedb.setCurrentInterpretationNumber(currInterpretationNumber+1);
                return interpretation
            }
        }
        else if(interp.label == "Create a Time Series"){
            const series_type = await vscode.window.showQuickPick(
                [
                    { label : "Pose3D Time Series" },
                    { label : "Geom3D Transform Time Series" }
                ], {
                placeHolder: 'Select Domain Space'
            });
            if(series_type == undefined){
                return null;
            }
            else if(series_type.label == "Pose3D Time Series"){

                let time_spaces = peircedb.getTimeSpaces();
                console.log(time_spaces);
                const time_space = await vscode.window.showQuickPick(time_spaces, {
                    placeHolder: 'Select a coordinate space'
                });

                if(time_space == null)
                    return null

                let spaces = peircedb.getGeom3DSpaces();
                console.log(spaces);
                let i = 0;
                const space = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select a coordinate space'
                });

                if(space == null)
                    return null
                
                let interpretation : models.Pose3DTimeSeries = {
                    label: "",
                    name: "",
                    interp_type: series_type.label,
                    time_space: time_space,
                    space: space,
                    values:[],
                    node_type: "term.node_type",
                    order_created: currInterpretationNumber,
                }
                peircedb.setCurrentInterpretationNumber(currInterpretationNumber+1);

                return interpretation
            }
            else if(series_type.label == "Geom3D Transform Time Series"){
                let time_spaces = peircedb.getTimeSpaces();
                console.log(time_spaces);
                const time_space = await vscode.window.showQuickPick(time_spaces, {
                    placeHolder: 'Select a coordinate space'
                });

                if(time_space == null)
                    return null

                let spaces = peircedb.getGeom3DSpaces();

                const domain = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select Domain Space'
                });
                console.log("space quick pick")
                console.log(domain);
                if (domain === undefined) {
                    return null;
                }
                console.log(spaces);
                const codomain = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select Codomain Space'
                });
                console.log("space quick pick")
                console.log(codomain);
                if (codomain === undefined) {
                    return null;
                }
                
                let interpretation : models.Geom3DTransformTimeSeries = {
                    label: "",
                    name: "",
                    interp_type: series_type.label,
                    time_space: time_space,
                    domain: domain,
                    codomain: codomain,
                    values:[],
                    node_type: "term.node_type",
                    order_created: currInterpretationNumber,
                }
                peircedb.setCurrentInterpretationNumber(currInterpretationNumber+1);
                return interpretation
            }
            else
                return null
        }
        else return null;
        
    }

    async editSelectedTermItem(termItem:TermItem)  {
        console.log('editing TERM ITEM')
        console.log(termItem)
        if(termItem.id === undefined){
        }
        else {
            const term_ : models.Term | null = peircedb.getTermFromId(termItem.id)
            console.log(term_)
            if(term_ !== null){
                console.log("creating!")
                console.log(term_)
                let termIsIdentifier : boolean = term_.node_type.includes("IDENT");
                console.log("creating2!")
                let interpretation = await this.createInterpretation(termIsIdentifier, term_.node_type)
                if(interpretation === null){}
                else{
                    interpretation.node_type = term_.node_type
                    if(termIsIdentifier)
                        interpretation.name = term_.name
                    term_.interpretation = interpretation
                    //saveTerm(term_)
                    console.log('attempting api term save...')
                    let result : boolean = await this.addTermInterpretationRequest(term_)
                    if(result){
                        peircedb.saveTerm(term_)
                        console.log("success term")

                        
                        if(interpretation.interp_type == 'Pose3D Time Series' 
                            || interpretation.interp_type == "Geom3D Transform Time Series"){
                            let db = peircedb.getPeirceDb()
                            db.all_time_series.push(interpretation as models.TimeSeries);
                            peircedb.saveDb(db)
                            
                        }
                    }
                    else{
                        console.log("fail term")
                    }
                }
            }
            const cons_ : models.Constructor | null = peircedb.getConstructorFromId(termItem.id)
            console.log(cons_)
            if(cons_ !== null){
                console.log("CREATING INTEPRRETATION")
                let interpretation = await this.createInterpretation(true, "")
                if(interpretation === null){}
                else{
                    interpretation.node_type = cons_.node_type
                    cons_.interpretation = interpretation
                    console.log('attempting api cons save...')
                    let result : boolean = await this.addConstructorInterpretationRequest(cons_)
                    if(result){
                        peircedb.saveConstructor(cons_)
                        console.log("success cons")
                    }
                    else{
                        console.log("fail cons")
                    }
                }
            }
            const func_ : models.FunctionItem | null = peircedb.getFunctionItemFromId(termItem.id)
            console.log(func_)
            if(func_ !== null){
                console.log("CREATING INTEPRETATION")
                let interpretation = await this.createInterpretation(true, "")
                if(interpretation === null){}
                else{
                    interpretation.node_type = func_.node_type
                    func_.interpretation = interpretation
                    console.log('attempting api func save...')
                    let result : boolean = await this.addFunctionItemInterpretationRequest(func_)
                    if(result){
                        peircedb.saveFunctionItem(func_)
                        console.log("success func")
                    }
                    else{
                        console.log("fail func")
                    }
                }
            }
        }

        await this.check()

    }
    
    async check() {
        let terms = peircedb.getTerms()
        let constructors = peircedb.getConstructors()
        let function_items = peircedb.getFunctionItems()

        let editor = vscode.window.activeTextEditor;
        if (editor === undefined)
            return;
        const currentFile = vscode.window.activeTextEditor?.document.fileName;

        let request = {
            file: currentFile,
            fileName: vscode.window.activeTextEditor?.document.fileName,
            terms: terms,
            spaces: peircedb.getPeirceDb().time_coordinate_spaces.concat(peircedb.getPeirceDb().geom1d_coordinate_spaces),
            constructors: constructors,
            function_items: function_items,
        }
        let login = {
            method: "POST",
            body: JSON.stringify(request),
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            credentials: "include",
        };
        const apiUrl = "http://0.0.0.0:8080/api/check2";
        const response = await fetch(apiUrl, login);
        const data : models.Term[] = await response.json();
        console.log("DATA");
        console.log(data);
        //let data = resp.data
        for (let i = 0; i < data.length; i++) {
            terms[i] = data[i]
        }
        let i = 0;
        let terms_ = peircedb.getTerms();
        for (let j = 0; j < terms_.length; j++) {
            if (terms_[j].fileName != terms[i].fileName){
                continue;
            }
            console.log("TERM FROM API CALL")
            console.log(terms[i]);
            terms_[j].text = terms[i].text;
            terms_[j].error = terms[i].error;
            i++;
        }
        peircedb.saveTerms(terms_);

        const apiUrlAll = "http://0.0.0.0:8080/api/check3";
        
        let login2 = {
            method: "POST",
            body: JSON.stringify({}),
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            credentials: "include",
        };
        const responseAll = await fetch(apiUrlAll, login2);
        const dataAll : PopulateAPIData[] = await responseAll.json();
        peircedb.resetAllTerms(vscode.window.activeTextEditor?.document.fileName)
        dataAll.forEach(element => {
            console.log('adata??')
            console.log(element)
            console.log(element.coords.begin.line+','+element.coords.end.line)
            if(element.coords.begin.line > 0 && element.coords.begin.character > 0 
                && element.coords.end.line > 0 && element.coords.end.character > 0){
                let range = new vscode.Range(
                    new vscode.Position(element.coords.begin.line, element.coords.begin.character), 
                    new vscode.Position(element.coords.end.line, element.coords.end.character), 
                );
                // Might be able to clean this up
                // Set the vscode.editor.selection position,
                const defaultInterp = "No interpretation provided";
                if (editor){
                    // peircedb.addPeirceTerm(element.interp, element.node_type, element.error, editor, range);
    
                    // this might not be the best way to clear checked interps on repop, but it's the best I could figure out
                    // the previous way we were adding is left in in case we find bugs/it's better to have it the other way for
                    // future functionality
                    console.log('adding peirce all term')
                    peircedb.addPeirceAllTerm(defaultInterp, element.node_type, element.error, editor, range);
                }
            }
        });
        //peircedb.saveAllTerms(all_terms);


        setDecorations();
    }


    async addSpaceRequest(space_:models.Space) : Promise<boolean> {
        console.log('sending space')
        let request = {
            space:space_
        }
        console.log('SENDING CREATE SPACE REQUEST')
        console.log(request)
        console.log(JSON.stringify(request));
        let login = {
            method: "POST",
            body: JSON.stringify(request),
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            credentials: "include",
        };
        const apiUrl = "http://0.0.0.0:8080/api/createSpace";
        const response = await fetch(apiUrl, login);
        console.log('response??')
        console.log(response)
        const data : models.SuccessResponse = await response.json();
        console.log('returning...')
        return data.success
        
    }

    async addTimeSeriesOrValue() {
        
        let seriesorvalue = await vscode.window.showQuickPick(
            [{label:"Time Series"},{label:"Add Value to Existing Time Series"}]
        );

        if(seriesorvalue == null)
            return
        else if(seriesorvalue.label=="Time Series")
            await this.addTimeSeries()
        else
            await this.addTimeSeriesValue()
    }

    async addTimeSeriesValue(){
        let currInterpNumber = peircedb.getCurrentInterpretationNumber();
        let all_series = peircedb.getTimeSeries()
        let options = all_series.map((ele) => {
            return { label:ele.name};
        })
        let chosen_series = await vscode.window.showQuickPick(
            options
        );
        if(chosen_series == null)
            return null

        console.log(chosen_series)
        let time_series = all_series[0]

        let ts_idx = ''
        for(let ts in all_series){
            time_series = all_series[ts]
            if(time_series.name==chosen_series.label){
                ts_idx = ts
                break
            }
        }
        console.log(time_series)

        let time_space = time_series.time_space

        if(time_series.interp_type == "Pose3D Time Series"){

            let value = await vscode.window.showInputBox({ placeHolder: 'Time of Value?' });
            if (value === undefined || Number(value) == NaN)  {
                return null;
            }

            let time_ : models.Time = {
                label: "",
                name: "",
                interp_type: "Time",
                space: time_space,
                value: [+value],
                node_type: "term.node_type",
                order_created: currInterpNumber,
            }

            let pose3d_series = time_series as models.Pose3DTimeSeries

            let space = pose3d_series.space

            let ortvalue0 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 0?' });
            if (ortvalue0 === undefined || Number(ortvalue0) == NaN)  {
                return null;
            }
            let ortvalue1 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 1?' });
            if (ortvalue1 === undefined || Number(ortvalue1) == NaN)  {
                return null;
            }
            let ortvalue2 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 2?' });
            if (ortvalue2 === undefined || Number(ortvalue2) == NaN)  {
                return null;
            }

            let ortvalue3 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 3?' });
            if (ortvalue3 === undefined || Number(ortvalue3) == NaN)  {
                return null;
            }
            let ortvalue4 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 4?' });
            if (ortvalue4 === undefined || Number(ortvalue4) == NaN)  {
                return null;
            }
            let ortvalue5 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 5?' });
            if (ortvalue5 === undefined || Number(ortvalue5) == NaN)  {
                return null;
            }

            let ortvalue6 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 6?' });
            if (ortvalue6 === undefined || Number(ortvalue6) == NaN)  {
                return null;
            }
            let ortvalue7 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 7?' });
            if (ortvalue7 === undefined || Number(ortvalue7) == NaN)  {
                return null;
            }
            let ortvalue8 = await vscode.window.showInputBox({ placeHolder: 'Orientation Value at index 8?' });
            if (ortvalue8 === undefined || Number(ortvalue8) == NaN)  {
                return null;
            }

            let posvalue0 = await vscode.window.showInputBox({ placeHolder: 'Position Value at index 0?' });
            if (posvalue0 === undefined || Number(posvalue0) == NaN)  {
                return null;
            }
            let posvalue1 = await vscode.window.showInputBox({ placeHolder: 'Position Value at index 1?' });
            if (posvalue1 === undefined || Number(posvalue1) == NaN)  {
                return null;
            }
            let posvalue2 = await vscode.window.showInputBox({ placeHolder: 'Position Value at index 2?' });
            if (posvalue2 === undefined || Number(posvalue2) == NaN)  {
                return null;
            }

            let pose3d_ : models.Pose3D = {
                label: "",
                name: "",
                interp_type: "Pose3D",
                space: space,
                value: [+ortvalue0,+ortvalue1,+ortvalue2,+ortvalue3,+ortvalue4,+ortvalue5,+ortvalue6,+ortvalue7,+ortvalue8,+posvalue0,+posvalue1,+posvalue2],
                node_type: "term.node_type",
                order_created: currInterpNumber+1,
            }

            let interpretation : models.TimeStampedPose3D = {
                label: "",
                name: "",
                interp_type: "TimeStamped Pose3D",
                timestamp: time_,
                value: pose3d_,
                series_name:time_series.name,
                node_type: "term.node_type",
                order_created: currInterpNumber+2,
            }

            let resp : boolean = await this.addTimeSeriesValueRequest(time_series, interpretation)
            if(!resp){
                console.log("FAILED TO SAVE SPACE TO PEIRCE")
                return
            }
            peircedb.setCurrentInterpretationNumber(currInterpNumber+3);
        }
        else if(time_series.interp_type == "Geom3D Transform Time Series"){

            let value = await vscode.window.showInputBox({ placeHolder: 'Time of Value?' });
            if (value === undefined || Number(value) == NaN)  {
                return null;
            }

            let time_ : models.Time = {
                label: "",
                name: "",
                interp_type: "Time",
                node_type: "term.node_type",
                space: time_space,
                value: [+value],
                order_created: currInterpNumber,
            }

            let geom3d_transform_series = time_series as models.Geom3DTransformTimeSeries

            let domain = geom3d_transform_series.domain
            let codomain = geom3d_transform_series.codomain

            let ivalue:models.Geom3DTransform = {
                label: "",
                name: "",
                interp_type: "Time",
                node_type: "term.node_type",
                domain:domain,
                codomain:codomain,
                order_created: currInterpNumber+1,
            }

            let interpretation : models.TimeStampedGeom3DTransform = {
                label: "",
                name: "",
                interp_type: "TimeStamped Geom3D Transform",
                timestamp: time_,
                value:ivalue,
                series_name:time_series.name,
                node_type: "term.node_type",
                order_created: currInterpNumber+2
            }

            console.log('attempting val req...')
            let resp : boolean = await this.addTimeSeriesValueRequest(time_series, interpretation)
            if(!resp){
                console.log("FAILED TO SAVE TSV TO PEIRCE")
                return
            }
            peircedb.setCurrentInterpretationNumber(currInterpNumber+3);
        }
        else{
            console.log("UNMATCHED?")
        }

    };
    
    async addTimeSeriesValueRequest(time_series: models.TimeSeries, value: models.Interpretation) : Promise<boolean> {
        console.log('sending value')
        let request = {
            interpretation:value
        }
        console.log('SENDING ADD TIME SERIES VALUE REQUEST')
        console.log(request)
        console.log(JSON.stringify(request));
        let login = {
            method: "POST",
            body: JSON.stringify(request),
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            credentials: "include",
        };
        const apiUrl = "http://0.0.0.0:8080/api/addValueToTimeSeries";
        console.log('fetching???')
        const response = await fetch(apiUrl, login);
        console.log('response??')
        console.log(response)
        const data : models.SuccessResponse = await response.json();
        console.log('returning...')
        return data.success

    };


    async addTimeSeries(){
        let currInterpNumber = peircedb.getCurrentInterpretationNumber();
        const series_type = await vscode.window.showQuickPick(
                [
                    { label : "Pose3D Time Series" },
                    { label : "Geom3D Transform Time Series" }
                ], {
                placeHolder: 'Select Domain Space'
        });
        if(series_type == undefined){
            return
        }

        
        let pickedName = await vscode.window.showInputBox({ placeHolder: 'Name of interpretation?' });
        if (pickedName === undefined || pickedName == "" || pickedName == null)  {
            this.updatePreview();
            return
        }
        let name : string = pickedName

        if(series_type.label == "Pose3D Time Series"){

            let time_spaces = peircedb.getTimeSpaces();
            console.log(time_spaces);
            const time_space = await vscode.window.showQuickPick(time_spaces, {
                placeHolder: 'Select a coordinate space'
            });

            if(time_space == null)
                return

            let spaces = peircedb.getGeom3DSpaces();
            console.log(spaces);
            let i = 0;
            const space = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select a coordinate space'
            });

            if(space == null)
                return null
            
            let interpretation : models.Pose3DTimeSeries = {
                label: "",
                name: pickedName,
                interp_type: series_type.label,
                time_space: time_space,
                space: space,
                values:[],
                node_type: "term.node_type",
                order_created: currInterpNumber,
            }

            let resp : boolean = await this.addTimeSeriesRequest(interpretation)
            if(!resp){
                console.log("FAILED TO SAVE SPACE TO PEIRCE")
                return
            }
            let db = peircedb.getPeirceDb();
            db.all_time_series.push(interpretation);
            console.log('SAVIN...')
            peircedb.saveDb(db);
            console.log('FINSAVE...')
            peircedb.setCurrentInterpretationNumber(currInterpNumber+1);
        }
        else if(series_type.label == "Geom3D Transform Time Series"){
            let time_spaces = peircedb.getTimeSpaces();
            console.log(time_spaces);
            const time_space = await vscode.window.showQuickPick(time_spaces, {
                placeHolder: 'Select a coordinate space'
            });

            if(time_space == null)
                return null

            let spaces = peircedb.getGeom3DSpaces();

            const domain = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select Domain Space'
            });
            console.log("space quick pick")
            console.log(domain);
            if (domain === undefined) {
                return null;
            }
            console.log(spaces);
            const codomain = await vscode.window.showQuickPick(spaces, {
                placeHolder: 'Select Codomain Space'
            });
            console.log("space quick pick")
            console.log(codomain);
            if (codomain === undefined) {
                return null;
            }
            
            let interpretation : models.Geom3DTransformTimeSeries = {
                label: "",
                name: pickedName,
                interp_type: series_type.label,
                time_space: time_space,
                domain: domain,
                codomain: codomain,
                values:[],
                node_type: "term.node_type",
                order_created: currInterpNumber,
            }

            let resp : boolean = await this.addTimeSeriesRequest(interpretation)
            if(!resp){
                console.log("FAILED TO SAVE SPACE TO PEIRCE")
                return
            }
            let db = peircedb.getPeirceDb();
            db.all_time_series.push(interpretation);
            console.log('SAVIN...')
            peircedb.saveDb(db);
            console.log('FINSAVE...')
            peircedb.setCurrentInterpretationNumber(currInterpNumber+1);
        }

        let dbb = peircedb.getPeirceDb();
        console.log('TIME SERIES??')
        console.log(dbb.all_time_series)
    };


    
    async addTimeSeriesRequest(time_series: models.TimeSeries) : Promise<boolean> {
        console.log('sending space')
        let request = {
            time_series:time_series
        }
        console.log('SENDING CREATE TIME SERIES REQUEST')
        console.log(request)
        console.log(JSON.stringify(request));
        let login = {
            method: "POST",
            body: JSON.stringify(request),
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            credentials: "include",
        };
        const apiUrl = "http://0.0.0.0:8080/api/createTimeSeries";
        const response = await fetch(apiUrl, login);
        console.log('response??')
        console.log(response)
        const data : models.SuccessResponse = await response.json();
        console.log('returning...')
        return data.success

    };

    async addTermInterpretationRequest(term: models.Term) : Promise <boolean> {
        console.log('sending term')
        let request = {
            term:term
        }
        console.log('SENDING TERM INTERP REQUEST')
        console.log(request)
        console.log(JSON.stringify(request));
        let login = {
            method: "POST",
            body: JSON.stringify(request),
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            credentials: "include",
        };
        const apiUrl = "http://0.0.0.0:8080/api/createTermInterpretation";
        const response = await fetch(apiUrl, login);
        console.log('thisis the response?')
        console.log(response)
        const data : models.SuccessResponse = await response.json();
        console.log(data);
        return data.success

    };
    
    async addConstructorInterpretationRequest(cons: models.Constructor) : Promise <boolean> {
        console.log('sending cons')
        let request = {
            constructor:cons
        }
        console.log('SENDING CONS INTERP REQUEST')
        console.log(request)
        console.log(JSON.stringify(request));
        let login = {
            method: "POST",
            body: JSON.stringify(request),
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            credentials: "include",
        };
        const apiUrl = "http://0.0.0.0:8080/api/createConstructorInterpretation";
        const response = await fetch(apiUrl, login);
        console.log(response)
        const data : models.SuccessResponse = await response.json();
        return data.success

    };
    
    async addFunctionItemInterpretationRequest(func: models.FunctionItem) : Promise <boolean> {
        let request = {
            function_item:func
        }
        console.log('SENDING FUNC INTERP REQUEST')
        console.log(request)
        console.log(JSON.stringify(request));
        let login = {
            method: "POST",
            body: JSON.stringify(request),
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            credentials: "include",
        };
        const apiUrl = "http://0.0.0.0:8080/api/createFunctionInterpretation";
        const response = await fetch(apiUrl, login);
        console.log(response)
        const data : models.SuccessResponse = await response.json();
        return data.success

    };
    
    async addSpace(){
        let space_ : models.Space | undefined = undefined
        let spaceOptions : vscode.QuickPickItem[] = [];
        let time_space : vscode.QuickPickItem = {
            label: "Time Coordinate Space",
        };
        let geom1d_space : vscode.QuickPickItem = {
            label: "Geom1D Coordinate Space",
        };
        let geom3d_space : vscode.QuickPickItem = {
            label: "Geom3D Coordinate Space",
        };
        spaceOptions.push(time_space);
        spaceOptions.push(geom1d_space);
        spaceOptions.push(geom3d_space);
        let currInterpNumber = peircedb.getCurrentInterpretationNumber();
        let fileName = getActivePeirceFile();
        // if no valid file selected, do NOT continue
        if (!fileName){
            return;
        }
        const spaceTypePick = await vscode.window.showQuickPick(spaceOptions);
        console.log("quick pick")
        console.log(spaceTypePick);
        if (spaceTypePick === undefined)
            return;
        else if(spaceTypePick.label == "Time Coordinate Space"){
            let annotationText = await vscode.window.showInputBox({ placeHolder: 'Name of Time Coordinate Space?', value: "new space"});
            if (annotationText === undefined) 
                return;
            let stdder : vscode.QuickPickItem[] = [];
            let std : vscode.QuickPickItem = {
                label: "Standard Time Coordinate Space",
            };
            let der : vscode.QuickPickItem = {
                label: "Derived Time Coordinate Space",
            };
            stdder.push(std);
            stdder.push(der);
            const stdderPick = await vscode.window.showQuickPick(stdder);
            console.log(stdderPick);
            if(stdderPick === undefined){
                return;
            }
            else if(stdderPick.label == "Standard Time Coordinate Space"){
                const new_space : models.TimeCoordinateSpace = {
                    order_created: currInterpNumber,
                    label: annotationText,
                    space: "Classical Time Coordinate Space", 
                    parent: null, 
                    origin: null, 
                    basis: null 
                }
                let resp : boolean = await this.addSpaceRequest(new_space)
                if(!resp){
                    console.log("FAILED TO SAVE SPACE TO PEIRCE")
                    return
                }
                peircedb.setCurrentInterpretationNumber(currInterpNumber+1);
                let db = peircedb.getPeirceDb();
                db.time_coordinate_spaces.push(new_space);
                peircedb.saveDb(db);
                space_ = new_space
            }
            else if(stdderPick.label == "Derived Time Coordinate Space"){
                const spaces = peircedb.getTimeSpaces();
                const parent = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select a Parent Space'
                });
                console.log("quick pick")
                console.log(parent);
                if (parent === undefined)
                    return;

                const vec_magnitude = await vscode.window.showInputBox({ placeHolder: 'Coordinate of Basis?' });
                if (vec_magnitude === undefined || vec_magnitude == "" || Number(vec_magnitude) == NaN)
                    return;
                const point_magnitude = await vscode.window.showInputBox({ placeHolder: 'Coordinate of Origin?'});
                if (point_magnitude === undefined || point_magnitude == "" || Number(point_magnitude) == NaN)
                    return;
                const new_space : models.TimeCoordinateSpace = {
                    order_created: currInterpNumber,
                    label: annotationText, 
                    space: "Classical Time Coordinate Space", 
                    parent: parent, 
                    origin: [+point_magnitude], 
                    basis: [+vec_magnitude]
                }
                let resp : boolean = await this.addSpaceRequest(new_space)
                if(!resp){
                    console.log("FAILED TO SAVE SPACE TO PEIRCE")
                    return
                }
                peircedb.setCurrentInterpretationNumber(currInterpNumber+1);
                let db = peircedb.getPeirceDb();
                db.time_coordinate_spaces.push(new_space);
                peircedb.saveDb(db);
                space_ = new_space
            }
            else 
                console.log(stdderPick.label)
        }
        else if(spaceTypePick.label == "Geom1D Coordinate Space"){
            let annotationText = await vscode.window.showInputBox({ placeHolder: 'Name of Geom1D Coordinate Space?', value: "new space"});
            if (annotationText === undefined) 
                return;
            let stdder : vscode.QuickPickItem[] = [];
            let std : vscode.QuickPickItem = {
                label: "Standard Geom1D Coordinate Space",
            };
            let der : vscode.QuickPickItem = {
                label: "Derived Geom1D Coordinate Space",
            };
            stdder.push(std);
            stdder.push(der);
            const stdderPick = await vscode.window.showQuickPick(stdder);
            if(stdderPick === undefined)
                return;
            else if(stdderPick.label == "Standard Geom1D Coordinate Space"){
                const new_space : models.Geom1DCoordinateSpace = {
                    order_created: currInterpNumber,
                    label: annotationText,
                    space: "Classical Geom1D Coordinate Space", 
                    parent: null, 
                    origin: null, 
                    basis: null 
                }
                let resp : boolean = await this.addSpaceRequest(new_space)
                if(!resp){
                    console.log("FAILED TO SAVE SPACE TO PEIRCE")
                    return
                }
                peircedb.setCurrentInterpretationNumber(currInterpNumber+1);
                let db = peircedb.getPeirceDb();
                db.geom1d_coordinate_spaces.push(new_space);
                peircedb.saveDb(db);
                space_ = new_space
                
            }
            else if(stdderPick.label == "Derived Geom1D Coordinate Space"){
                const spaces = peircedb.getGeom1DSpaces();
                const parent = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select a Parent Space'
                });
                console.log("quick pick")
                console.log(parent);
                if (parent === undefined)
                    return;

                const vec_magnitude = await vscode.window.showInputBox({ placeHolder: 'Coordinate of Basis?' });
                if (vec_magnitude === undefined || vec_magnitude == "" || Number(vec_magnitude) == NaN)
                    return;
                const point_magnitude = await vscode.window.showInputBox({ placeHolder: 'Coordinate of Origin?'});
                if (point_magnitude === undefined || point_magnitude == "" || Number(point_magnitude) == NaN)
                    return;
                const new_space : models.Geom1DCoordinateSpace = {
                    order_created: currInterpNumber,
                    label: annotationText, 
                    space: "Classical Geom1D Coordinate Space", 
                    parent: parent, 
                    origin: [+point_magnitude], 
                    basis: [+vec_magnitude]
                }
                let resp : boolean = await this.addSpaceRequest(new_space)
                if(!resp){
                    console.log("FAILED TO SAVE SPACE TO PEIRCE")
                    return
                }
                peircedb.setCurrentInterpretationNumber(currInterpNumber+1);
                let db = peircedb.getPeirceDb();
                db.geom1d_coordinate_spaces.push(new_space);
                peircedb.saveDb(db);
                space_ = new_space
            }
        }
        else if(spaceTypePick.label == "Geom3D Coordinate Space"){
            let annotationText = await vscode.window.showInputBox({ placeHolder: 'Name of Geom3D Coordinate Space?', value: "new space"});
            if (annotationText === undefined) 
                return;
            let stdder : vscode.QuickPickItem[] = [];
            let std : vscode.QuickPickItem = {
                label: "Standard Geom3D Coordinate Space",
            };
            let der : vscode.QuickPickItem = {
                label: "Derived Geom3D Coordinate Space",
            };
            stdder.push(std);
            stdder.push(der);
            const stdderPick = await vscode.window.showQuickPick(stdder);
            if(stdderPick === undefined)
                return;
            else if(stdderPick.label == "Standard Geom3D Coordinate Space"){
                const new_space : models.Geom3DCoordinateSpace = {
                    order_created: currInterpNumber,
                    label: annotationText,
                    space: "Classical Geom3D Coordinate Space", 
                    parent: null, 
                    origin: null, 
                    basis: null 
                }
                let resp : boolean = await this.addSpaceRequest(new_space)
                console.log('returned from save space request?')
                if(!resp){
                    console.log("FAILED TO SAVE SPACE TO PEIRCE")
                    return
                }
                else
                    console.log("SAVED")
                peircedb.setCurrentInterpretationNumber(currInterpNumber+1);
                let db = peircedb.getPeirceDb();
                console.log('SAVE IT???')
                console.log(new_space)
                db.geom3d_coordinate_spaces.push(new_space);
                peircedb.saveDb(db);
                console.log('SAVED???')
                space_ = new_space
                
            }
            else if(stdderPick.label == "Derived Geom3D Coordinate Space"){
                const spaces = peircedb.getGeom3DSpaces();
                const parent = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select a Parent Space'
                });
                console.log("quick pick")
                console.log(parent);
                if (parent === undefined)
                    return;

                let basis_values : number[] = []
                let origin_values : number[] = []

                for(const i of [0,1,2]){
                    //let basisij : string | undefined = ""
                    for(const j of [0,1,2]){

                        let basisij = await vscode.window.showInputBox({ placeHolder: 'Coordinate of Basis Vector '+i+ ", Column "+j+"?" });
                        
                        if (basisij === undefined || basisij == "" || Number(basisij) == NaN)
                            return;
                        basis_values.push(+basisij)
                    }
                }

                for(const i of [0, 1, 2]){
                    let originij = await vscode.window.showInputBox({ placeHolder: 'Coordinate of Origin at Index '+i+"?" });
                        
                    if (originij === undefined || originij == "" || Number(originij) == NaN)
                        return;
                    origin_values.push(+originij)    
                }

                const new_space : models.Geom3DCoordinateSpace = {
                    order_created: currInterpNumber,
                    label: annotationText, 
                    space: "Classical Geom3D Coordinate Space", 
                    parent: parent, 
                    origin: origin_values, 
                    basis: basis_values
                }
                let resp : boolean = await this.addSpaceRequest(new_space)
                if(!resp){
                    console.log("FAILED TO SAVE SPACE TO PEIRCE")
                    return
                }
                peircedb.setCurrentInterpretationNumber(currInterpNumber+1);
                let db = peircedb.getPeirceDb();
                db.geom3d_coordinate_spaces.push(new_space);
                peircedb.saveDb(db);
                space_ = new_space
            }
        }
    }

    async editHoveredTerms() {
        console.log("Editing hovered terms...")
	    let terms = peircedb.getTerms();
        console.log("Got terms...");
        console.log(terms);
        let hover_index = 0;
        for (let index = 0; index < terms.length; index++) {
            let term = terms[index];
            console.log("Trying terms["+index+"]", term);
            if (!this.isHoveredTerm(term)) continue;
            this.updatePreviewIndex(hover_index);
            console.log("GOT IT!["+index+"]", term);

            let termIsIdentifier : boolean = term.node_type.includes("IDENT");


            let interpretations : vscode.QuickPickItem[] = [
                { label: "Duration" },
                { label: "Time" },
                { label: "Scalar"},
                { label: "Time Transform"},
                { label: "Displacement1D"},
                { label: "Position1D"},
                { label: "Geom1D Transform"},
                { label: "Displacement3D"},
                { label: "Position3D"},
                { label: "Geom3D Transform"},
                { label: "TimeStamped Pose3D"},
                { label: "TimeStamped Geom3D Transform"}
            ];

            if(termIsIdentifier){
                interpretations.push(
                    { label: "Create a Time Series"}
                );
            }

            const interp = await vscode.window.showQuickPick(interpretations);
            if (interp === undefined) {
                hover_index++;
                this.updatePreview();
                continue;
            }

            let name = "<identifier>";

            // If the following is true (the AST node is an identifier)
            // Peirce will not prompt for a name, so we won't ask for one.
            if (!termIsIdentifier) {
                let pickedName = await vscode.window.showInputBox({ placeHolder: 'Name of interpretation?' });
                if (pickedName === undefined || pickedName == "")  {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
                name = pickedName;
            }
            // get the current Interpretation number and increment
            let currInterpretationNumber = peircedb.getCurrentInterpretationNumber();
            peircedb.setCurrentInterpretationNumber(currInterpretationNumber+1);

            if(interp.label == "Duration"){

                let spaces = peircedb.getTimeSpaces();
                console.log(spaces);
                let i = 0;
                const space = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select a coordinate space'
                });
                console.log("space quick pick")
                console.log(space);
                if (space === undefined) {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
    
                let value = await vscode.window.showInputBox({ placeHolder: 'Value?' });
                if (value === undefined || Number(value) == NaN)  {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
    
                let label = `${name} ${interp.label}(${space.label},${value})`
                if (termIsIdentifier) {
                    label = `${interp.label}(${space.label},${value})`
                }
    
                let interpretation : models.Duration = {
                    label: label,
                    name: name,
                    interp_type: interp.label,
                    space: space,
                    value: [+value],
                    node_type: term.node_type,
                    order_created: currInterpretationNumber
                }
                terms[index].interpretation = interpretation;
                peircedb.saveTerms(terms);
                console.log("Saving terms["+index+"]");
                hover_index++;
                this.updatePreview();
                
            }
            else if(interp.label == "Time"){

                let spaces = peircedb.getTimeSpaces();
                console.log(spaces);
                let i = 0;
                const space = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select a coordinate space'
                });
                console.log("space quick pick")
                console.log(space);
                if (space === undefined) {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
    
                let value = await vscode.window.showInputBox({ placeHolder: 'Value?' });
                if (value === undefined || Number(value) == NaN)  {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
    
                let label = `${name} ${interp.label}(${space.label},${value})`
                if (termIsIdentifier) {
                    label = `${interp.label}(${space.label},${value})`
                }
    
                let interpretation : models.Time = {
                    label: label,
                    name: name,
                    interp_type: interp.label,
                    space: space,
                    value: [+value],
                    node_type: term.node_type,
                    order_created: currInterpretationNumber
                }
                terms[index].interpretation = interpretation;
                peircedb.saveTerms(terms);
                console.log("Saving terms["+index+"]");
                hover_index++;
                this.updatePreview();
            }
            else if(interp.label == "Scalar"){

                let value = await vscode.window.showInputBox({ placeHolder: 'Value?' });
                if (value === undefined || Number(value) == NaN)  {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
    
                let label = `${name} ${interp.label}(${value})`
                if (termIsIdentifier) {
                    label = `${interp.label}(${value})`
                }
    
                let interpretation : models.Scalar = {
                    label: label,
                    name: name,
                    interp_type: interp.label,
                    value: [+value],
                    node_type: term.node_type,
                    order_created: currInterpretationNumber
                }
                terms[index].interpretation = interpretation;
                peircedb.saveTerms(terms);
                console.log("Saving terms["+index+"]");
                hover_index++;
                this.updatePreview();

            }
            else if(interp.label == "Time Transform"){

                let spaces = peircedb.getTimeSpaces();
                console.log(spaces);
                let i = 0;
                const domain = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select a time coordinate space'
                });
                console.log("space quick pick")
                console.log(domain);
                if (domain === undefined) {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
                console.log(spaces);
                const codomain = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select a time coordinate space'
                });
                console.log("space quick pick")
                console.log(codomain);
                if (codomain === undefined) {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
                let label = `${name} ${interp.label}(${domain.label},${codomain.label})`
                if (termIsIdentifier) {
                    label = `${interp.label}(${domain.label},${codomain.label})`
                }
    
    
                let interpretation : models.TimeTransform = {
                    label: label,
                    name: name,
                    interp_type: interp.label,
                    domain: domain,
                    codomain: codomain,
                    node_type: term.node_type,
                    order_created: currInterpretationNumber
                }
                terms[index].interpretation = interpretation;
                peircedb.saveTerms(terms);
                console.log("Saving terms["+index+"]");
                hover_index++;
                this.updatePreview();
            }
            else if(interp.label == "Displacement1D"){

                let spaces = peircedb.getGeom1DSpaces();
                console.log(spaces);
                let i = 0;
                const space = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select a coordinate space'
                });
                console.log("space quick pick")
                console.log(space);
                if (space === undefined) {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
    
                let value = await vscode.window.showInputBox({ placeHolder: 'Value?' });
                if (value === undefined || Number(value) == NaN)  {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
    
                let label = `${name} ${interp.label}(${space.label},${value})`
                if (termIsIdentifier) {
                    label = `${interp.label}(${space.label},${value})`
                }
    
                let interpretation : models.Displacement1D = {
                    label: label,
                    name: name,
                    interp_type: interp.label,
                    space: space,
                    value: [+value],
                    node_type: term.node_type,
                    order_created: currInterpretationNumber
                }
                terms[index].interpretation = interpretation;
                peircedb.saveTerms(terms);
                console.log("Saving terms["+index+"]");
                hover_index++;
                this.updatePreview();
            }
            else if(interp.label == "Position1D"){

                let spaces = peircedb.getGeom1DSpaces();
                console.log(spaces);
                let i = 0;
                const space = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select a coordinate space'
                });
                console.log("space quick pick")
                console.log(space);
                if (space === undefined) {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
    
                let value = await vscode.window.showInputBox({ placeHolder: 'Value?' });
                if (value === undefined || Number(value) == NaN)  {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
    
                let label = `${name} ${interp.label}(${space.label},${value})`
                if (termIsIdentifier) {
                    label = `${interp.label}(${space.label},${value})`
                }
    
                let interpretation : models.Position1D = {
                    label: label,
                    name: name,
                    interp_type: interp.label,
                    space: space,
                    value: [+value],
                    node_type: term.node_type,
                    order_created: currInterpretationNumber
                }
                terms[index].interpretation = interpretation;
                peircedb.saveTerms(terms);
                console.log("Saving terms["+index+"]");
                hover_index++;
                this.updatePreview();
            }
            else if(interp.label == "Geom1D Transform"){
                
                let spaces = peircedb.getGeom1DSpaces();
                console.log(spaces);
                let i = 0;
                const domain = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select a time coordinate space'
                });
                console.log("space quick pick")
                console.log(domain);
                if (domain === undefined) {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
                console.log(spaces);
                const codomain = await vscode.window.showQuickPick(spaces, {
                    placeHolder: 'Select a time coordinate space'
                });
                console.log("space quick pick")
                console.log(codomain);
                if (codomain === undefined) {
                    hover_index++;
                    this.updatePreview();
                    continue;
                }
                let label = `${name} ${interp.label}(${domain.label},${codomain.label})`
                if (termIsIdentifier) {
                    label = `${interp.label}(${domain.label},${codomain.label})`
                }
    
    
                let interpretation : models.Geom1DTransform = {
                    label: label,
                    name: name,
                    interp_type: interp.label,
                    domain: domain,
                    codomain: codomain,
                    node_type: term.node_type,
                    order_created: currInterpretationNumber
                }
                terms[index].interpretation = interpretation;
                peircedb.saveTerms(terms);
                console.log("Saving terms["+index+"]");
                hover_index++;
                this.updatePreview();
            }
        }

        await this.check()
    }

    private isHoveredTerm(term : models.Term) : boolean {
        let loc = this.getActiveCursorLocation();
        let condition = (loc && term.fileName == vscode.window.activeTextEditor?.document.fileName 
            && term.positionStart.line <= loc.line && term.positionEnd.line >= loc.line);
        if (condition == null) return false;
        return condition;
    }

    private displayTerm(term : models.Term, editing: boolean) : string {
        let full : string = "";
        if (term) {
            if (editing)
                full += `<pre style="color: lightgreen">${JSON.stringify(term, undefined, 2)}</pre></b>`
            else
                full += "<pre>" + JSON.stringify(term, undefined, 2) + "</pre>"
        }
        return full;
    }

    // <script src="${this.getMediaPath('index.js')}"></script>
    async updatePreview() {
        this.updatePreviewIndex(-1);
    }
    async updatePreviewIndex(index : number) {
        console.log(index);
        let contents : string = "";
        let terms = this.getHoveredTerms();
        for (let i = 0; i < terms.length; i++)
            contents += this.displayTerm(terms[i], i == index);
        contents += '<p style="color:lightblue">Key bindings</p>';
        contents += '<p style="color:lightblue"><b>Ctrl+Alt+R</b> to generate unfilled type information annotations</p>';
        contents += '<p style="color:lightblue"><b>Ctrl+Alt+E</b> to edit existing type information annotations</p>';
        contents += '<p style="color:lightblue"><b>Ctrl+Alt+S</b> to add spaces</p>';

        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8" />
                <meta http-equiv="Content-type" content="text/html;charset=utf-8">
                <title>Infoview</title>
                <style></style>
            </head>
            <body>
                <div id="react_root"></div>
                ${contents}
                <!-- script here -->
            </body>
            </html>`
        this.webviewPanel.webview.html = html;
    }

    async openPreview() {
        vscode.window.onDidChangeTextEditorSelection(() => this.updatePreview());
        let editor = undefined;
        if (vscode.window.activeTextEditor != undefined) {
            editor = vscode.window.activeTextEditor;
        }
        else 
            return;
        let column = (editor && editor.viewColumn) ? editor.viewColumn + 1 : vscode.ViewColumn.Two;
        const loc = this.getActiveCursorLocation();
        console.log(loc);
        if (column === 4) { column = vscode.ViewColumn.Three; }
        this.webviewPanel = vscode.window.createWebviewPanel('Peirce', 'Peirce Infoview',
            { viewColumn: column, preserveFocus: true },
            {
                enableFindWidget: true,
                retainContextWhenHidden: true,
                enableScripts: true,
                enableCommandUris: true,
            });
        this.updatePreview();
        //this.webviewPanel.onDidDispose(() => this.webviewPanel = null);
    }
}

export class TreeActions {
    //constructor(private provider: TermsTree) { }
    constructor(private provider: PeirceTree, private iv : InfoView) { }

    removeTerm(item: TermItem) {
        return this.provider.removeItem(item.id);
    }
    checkTerm(item: TermItem) {
        return this.provider.checkItem(item.id, 'done');
    }
    uncheckTerm(item: TermItem) {
        return this.provider.checkItem(item.id, 'pending');
    }
    checkAllTerms(data: any): void {
        const children = data.children;
        if (!children) { return; }

        for (let index = 0; index < children.length; index++) {
            const current = children[index];
            this.checkTerm(current);
        }
    }
    uncheckAllTerms(data: any): void {
        const children = data.children;
		
        if (!children) { return; }

        for (let index = 0; index < children.length; index++) {
            const current = children[index];
            this.uncheckTerm(current);
        }
    }
    removeAllTerms(data: any): void {
        const children = data.children;
		
        if (!children) { return; }

        for (let index = 0; index < children.length; index++) {
            const current = children[index];
            this.removeTerm(current);
        }
    }
    openTerm(item: TermItem) {
        return this.provider.openItem(item.id);
    }
    openTermFromId(id: string) {
        return this.provider.openItem(id);
    }
    copyTerm(item: TermItem) {
        return this.provider.copyItem(item.id);
    }
    editTerm(item: TermItem):void {
        console.log(item.id);
        this.iv.editSelectedTermItem(item)
    }
    addSpace():void{
        console.log('RUNNING IV ADD SPACE')
        this.iv.addSpace()
    }
    addTimeSeriesOrValue():void{
        console.log('RUNNING IV ADD TS');
        this.iv.addTimeSeriesOrValue()
    }

}
export class PeirceTree implements vscode.TreeDataProvider<TermItem> {

	private _onDidChangeTreeData: vscode.EventEmitter<TermItem | undefined | null | void> = new vscode.EventEmitter<TermItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TermItem | undefined | null | void> = this._onDidChangeTreeData.event;

	refresh(): void {
        console.log('calling source data')
	    this.sourceData();
        console.log('finished source data?')
	    this._onDidChangeTreeData.fire(null);
	}

	sourceData(): void {
	    this.data = [];
	    this.data = [
            new TermItem('Table of Terms', undefined, undefined, '$menu-pending'),
            new TermItem('Constructors', undefined, undefined, '$menu-pending'),
            new TermItem('Function Items', undefined, undefined, '$menu-pending'),
            new TermItem('Spaces', undefined, undefined, '$Space'),
            new TermItem('Time Series', undefined, undefined, '$TimeSeries')
        ];
        console.log("In terms tree")
	    const annotations = peircedb.getTerms();
        console.log('')
        console.log(annotations)
        const fileName = getActivePeirceFile();
        let numFileAnnotations = 0;
	    for (let term in annotations) {
            if (annotations[term].fileName != fileName)
                continue;
	        const termItem = createTermItem(annotations[term]);
            numFileAnnotations += 1;
            this.data[0].addChild(termItem);
	    }
        // this needs to be changed s.t. it has the right number of annotations for the file lol
	    this.data[0].label += ` (${numFileAnnotations})`;


	    const constructors = peircedb.getConstructors() || ([]);
        console.log(constructors)
	    for (let term in constructors) {
            //if (constructors[term].fileName != vscode.window.activeTextEditor?.document.fileName)
            //    continue;
	        const termItem = createConsTermItem(constructors[term]);
            this.data[1].addChild(termItem);
	    }
        // same here
	    this.data[1].label += ` (${constructors.length})`;


	    const function_items = peircedb.getFunctionItems() || ([]);
        console.log('where are function items?')
        console.log(function_items)
	    for (let term in function_items) {
            //if (constructors[term].fileName != vscode.window.activeTextEditor?.document.fileName)
            //    continue;
	        const funcItem = createFunctionItem(function_items[term]);
            this.data[2].addChild(funcItem);
	    }
        // same here
	    this.data[2].label += ` (${function_items.length})`;

        const db = peircedb.getPeirceDb()

        console.log('heres my db?')
        console.log(db)

	    const spaces = 
            (peircedb.getTimeSpaces() || [])
            .concat(peircedb.getGeom1DSpaces() || [])
            .concat(peircedb.getGeom3DSpaces() || []);
        console.log("spaces")
        console.log(spaces)
	    for (let s in spaces) {
            const space = spaces[s];
            let termItem : TermItem;
            if (space.space == "Classical Time Coordinate Space"){
                if (space.parent != null){
                    termItem = new TermItem(`${space.label} (Derived from ${space.parent.label}): Origin: ${space.origin} Basis: ${space.basis}`)
                    this.data[3].addChild(termItem);
                }
                else {
                    termItem = new TermItem(`${space.label} : Standard Time Space`);
                    this.data[3].addChild(termItem);
                }
            }
            else if (space.space == "Classical Geom1D Coordinate Space") {
                if (space.parent != null){
                    termItem = new TermItem(`${space.label} (Derived from ${space.parent.label}): Origin: ${space.origin} Basis: ${space.basis}`)
                    const origin = space.origin;
                    this.data[3].addChild(termItem);
                }
                else{
                    termItem = new TermItem(`${space.label} : Standard Geom1D Space`);
                    const origin = space.origin;
                    this.data[3].addChild(termItem);
                }
            }
            else if (space.space == "Classical Geom3D Coordinate Space") {
                if (space.parent != null){
                    termItem = new TermItem(`${space.label} (Derived from ${space.parent.label}): Origin: ${space.origin} Basis: ${space.basis}`)
                    const origin = space.origin;
                    this.data[3].addChild(termItem);
                }
                else{
                    termItem = new TermItem(`${space.label} : Standard Geom3D Space`);
                    const origin = space.origin;
                    this.data[3].addChild(termItem);
                }
            }
            else {
            }
            //const origin = space.origin;
            //this.data[1].addChild(termItem);
	    }
	    this.data[3].label += ` (${spaces.length})`;

        const time_series =
            (peircedb.getTimeSeries() || [])

        console.log('HOW LARGE IS TIME SERIES?')
        console.log(this.data.length)
        console.log(time_series)

        for(let ts_idx in time_series){
            let ts = time_series[ts_idx]
            let label = `${ts.name} : ${ts.interp_type} (${ts.time_space.label}`

            console.log('iterating over...')
            console.log(ts)
            if(ts.label == "Pose3D Time Series"){
                let ts_ = ts as models.Pose3DTimeSeries
                label = label + `,${ts_.space.label})`
                let termItem = new TermItem(label);
                this.data[4].addChild(termItem);
                console.log('added pose3d')
            }
            if(ts.label == "Geom3D Transform Time Series"){
                let ts_ = ts as models.Geom3DTransformTimeSeries
                label = label + `,${ts_.domain.label},${ts_.codomain.label})`
                let termItem = new TermItem(label);
                this.data[4].addChild(termItem);
                console.log('added trans ge3')
            }

            //let termItem = new TermItem(`${ts.name} : ${ts.interp_type}` );
        }
        
        console.log('finished...')
        this.data[4].label += ` (${time_series.length})`;
        console.log('returning')
        console.log(this.data[4].label)
        console.log(this.data)

        
	}

	removeItem(id: string | undefined): void {
	    const terms = peircedb.getTerms();
	    const indexToRemove = terms.findIndex((item: { id: Number }) => {
	        return item.id.toString() === id;
	    });

	    if (indexToRemove >= 0) {
	        terms.splice(indexToRemove, 1);
	    }

	    peircedb.saveTerms(terms);
	    setDecorations();
	}

	checkItem(id: string | undefined, status: 'pending' | 'done'): void {
	    const terms = peircedb.getTerms();
	    const index = terms.findIndex((item: { id: Number }) => {
	        return item.id.toString() === id;
	    });

	    if (index >= 0) {
	        terms[index].status = status;
	    }

	    peircedb.saveTerms(terms);
	}

	openItem(id: string | undefined): void {
	    const terms = peircedb.getTerms();
	    const index = terms.findIndex((item: { id: Number }) => {
	        return item.id.toString() === id;
	    });

	    if (index >= 0) {
	        const term = terms[index];
	        const fileName = term.fileName;
	        const fileLine = term.fileLine;

	        if (fileName.length <= 0) {
	            return;
	        }

	        var openPath = vscode.Uri.file(fileName);
	        vscode.workspace.openTextDocument(openPath).then(doc => {
	            vscode.window.showTextDocument(doc).then(editor => {
	                var range = new vscode.Range(fileLine, 0, fileLine, 0);
	                editor.revealRange(range);

	                var start = new vscode.Position(term.positionStart.line, term.positionStart.character);
	                var end = new vscode.Position(term.positionEnd.line, term.positionEnd.character);
	                editor.selection = new vscode.Selection(start, end);

	                var range = new vscode.Range(start, start);
	                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
	            });
	        });
	    }
	}

	copyItem(id: string | undefined): void {
	    const terms = peircedb.getTerms();
	    const index = terms.findIndex((item: { id: Number }) => {
	        return item.id.toString() === id;
	    });

	    if (index === -1) {
	        return;
	    }

	    const content = terms[index].text;
	    vscode.env.clipboard.writeText(content).then(() => {
	        vscode.window.showInformationMessage('Term copied successfully');
	    });
	}

	data: TermItem[];

	constructor() {
	    vscode.commands.registerCommand('code-annotation.refreshEntry', () =>
	        this.refresh()
	    );

	    this.data = [];
	    this.sourceData();
	}

	getTreeItem(element: TermItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
	    return element;
	}

	getChildren(element?: TermItem | undefined): vscode.ProviderResult<TermItem[]> {
	    if (element === undefined) {
	        return this.data;
	    }
	    return element.children;
	}
}

class OpenTermCommand implements vscode.Command {
	command = 'code-annotation.openTermFromId';
	title = 'Open File';
	arguments?: any[];

	constructor(id: string) {
	    this.arguments = [id];
	}
}

export class TermItem extends vscode.TreeItem {
	children: TermItem[] | undefined;

	constructor(label: string, children?: TermItem[] | undefined, termId?: string | undefined, context?: string | undefined) {
	    super(
	        label,
	        children === undefined ? vscode.TreeItemCollapsibleState.None :
	            vscode.TreeItemCollapsibleState.Expanded);
	    this.children = children;
	    if (termId) {
	        this.id = termId;
	    }
	    if (context) {
	        this.contextValue = context;
	    }
	}

	addChild(element: TermItem) {
	    if (this.children === undefined) {
	        this.children = [];
	        this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
	    }
	    this.children.push(element);
	}
}
