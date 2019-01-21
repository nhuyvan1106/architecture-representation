import { Component, ElementRef, AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, HostListener, OnInit, Host, ViewEncapsulation, Output, EventEmitter } from '@angular/core';
import { zeros, Matrix, multiply, subtract, matrix, transpose, divide, hypot, dot, sum, norm } from 'mathjs';
import { MatDialog } from '@angular/material/dialog';
import { svgAsPngUri, download } from 'save-svg-as-png';
import { Observable } from 'rxjs';
import { DatePipe } from '@angular/common';

import { MatricesComponent } from './views/matrices/matrices.component';
import { Link } from './models/Link';
import { Column, ColumnId } from './models/Column';
import { Cell } from './models/Cell';
import { ColumnLayoutChange, ColumnLayoutChangeType } from './models/ColumnLayoutChange';
import { CellSelectionEvent, CellSelectionEventType } from './models/CellSelectionEvent';
import { ColumnLayoutChangeService } from './services/column-layout-change.service';
import { CellGroup } from './models/CellGroup';
import { CommandService, CommandAction, Command } from '@shared/command';
import { MatrixEditorComponent } from './views/matrix-editor/matrix-editor.component';
import { GraphModel, CellGraphModel, LinkGraphModel } from '@shared/graph-model';
import { Attribute, AttributeEditorComponent } from '@shared/attribute-editor';
import { FilePickerService } from '@shared/file-picker';

@Component({
  selector: 'mapper-graph',
  templateUrl: './graph.component.html',
  styleUrls: ['./graph.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'frame'
  },
  encapsulation: ViewEncapsulation.None
})
export class GraphComponent implements AfterViewInit, OnInit {

  @Output()
  modelChanged = new EventEmitter<GraphModel>();

  columnWidth = 0;
  columnHeight = 0;
  readonly headerHeight = 100;
  spacingBetweenColumns = 0;
  linkTable = new Map<Cell, Array<Link>>();
  selectedLink: Link;
  readonly columns: Column = {
    element: [],
    property: [],
    quality: []
  };
  readonly cellGroups = {
    element: [new CellGroup(0, false, 0, 0, 0, 0)],
    property: [new CellGroup(0, false, 0, 0, 0, 0)],
    quality: [new CellGroup(0, false, 0, 0, 0, 0)]
  };
  selectedCells: Cell[] = [];
  showAssociations = false;

  private _canvasContainer: SVGSVGElement;
  private _canvasContainerRect: ClientRect;
  private _canvasInitialHeight = 0;
  private _Dp = matrix(zeros(1, 1));
  private _Dq = matrix(zeros(1, 1));
  private _graphModel: GraphModel = null;

  constructor(
    private _changeDetector: ChangeDetectorRef,
    private _columnLayoutChange: ColumnLayoutChangeService,
    private _commandService: CommandService,
    @Host() private readonly _hostElement: ElementRef<HTMLElement>,
    private _matDialog: MatDialog,
    private _filePicker: FilePickerService
  ) {
  }

  ngAfterViewInit() {
    // ExpressionChangedAfterItHasBeenCheckedError avoidance because this is ngAfterViewInit
    setTimeout(() => {
      this._canvasContainer = this._hostElement.nativeElement.firstElementChild as SVGSVGElement;
      this._canvasContainerRect = this._canvasContainer.getBoundingClientRect();
      // 12.5% each
      this.spacingBetweenColumns = this._canvasContainerRect.width * 12.5 / 100;
      // 25% each
      this.columnWidth = this._canvasContainerRect.width * 25 / 100;
      this.columnHeight = this._canvasContainerRect.height - this.headerHeight;
      this._canvasInitialHeight = this.columnHeight;
      this._changeDetector.markForCheck();
    }, 1000);
  }

  ngOnInit() {
    this._columnLayoutChange.observe()
      .subscribe(layoutChange => this._onColumnLayoutChanged(layoutChange));

    this._commandService.observe()
      .subscribe((command: Command) => {
        switch (command.action) {
          case CommandAction.TOGGLE_SHOW_ASSOCIATIONS:
            this._toggleAssociationsForSelectedComponents(!this.showAssociations);
            break;
          case CommandAction.GROUP_CELLS:
            this._groupSelectedCells();
            break;
          case CommandAction.UNGROUP_CELLS:
            this._ungroupSelectedCells();
            break;
          case CommandAction.SHOW_MATRICES:
            this._showMatrices();
            break;
          case CommandAction.TURN_CELL_ON:
            this._turnCellsOnOrOff(true);
            break;
          case CommandAction.TURN_CELL_OFF:
            this._turnCellsOnOrOff(false);
            break;
          case CommandAction.EXPORT_GRAPH_AS_PNG:
            this._exportGraphAsPng();
            break;
          case CommandAction.EDIT_Dp_DETRACTOR_MATRIX:
            this._editDpMatrix();
            break;
          case CommandAction.EDIT_Dq_DETRACTOR_MATRIX:
            this._editDqMatrix();
            break;
          case CommandAction.SAVE_GRAPH_MODEL:
            this._saveGraphModel();
            break;
          case CommandAction.IMPORT_GRAPH_MODEL:
            this._filePicker.open()
              .readFileAsJson<GraphModel>()
              // .pipe(catchError(err => { console.log(err); return of(null); })) TODO: Show error dialog
              .subscribe(model => {
                if (model)
                  this._importGraphModel(model);
              });
            break;
        }
      });
  }

  private _toggleAssociationsForSelectedComponents(state: boolean) {
    this.showAssociations = state;
    this._changeDetector.detectChanges();
  }

  private _groupSelectedCells() {
    const cellsToGroup = this.selectedCells.filter(cell => cell.column === 'element');
    if (cellsToGroup.length > 0) {
      const newGroup = new CellGroup(this.cellGroups.element.length, true, 0, 0, this.columnWidth, 0);
      for (const elementCell of cellsToGroup) {
        elementCell.cellGroup.removeCell(elementCell);
        this._removeNonDefaultCellGroupIfEmpty(elementCell.cellGroup);
        newGroup.addCell(elementCell);
      }
      this._addNewCellGroup(newGroup);
      this._notifyChanges('element');
    }
  }

  private _addNewCellGroup(cellGroup: CellGroup) {
    const defaultGroup = this.cellGroups.element.pop();
    this.cellGroups.element = this.cellGroups.element.concat(cellGroup, defaultGroup);
    this._changeDetector.detectChanges();
  }

  private _ungroupSelectedCells(addToDefaultGroup = true) {
    for (const cellToUngroup of this.selectedCells) {
      cellToUngroup.cellGroup.removeCell(cellToUngroup);
      // Only remove the owning group if it is not the default group and empty
      this._removeNonDefaultCellGroupIfEmpty(cellToUngroup.cellGroup);
      if (addToDefaultGroup)
        this._addToDefaultCellGroup(cellToUngroup);
    }
    this._notifyChanges('element');
  }

  private _removeNonDefaultCellGroupIfEmpty(cellGroup: CellGroup) {
    if (this.cellGroups.element.length > 1 && cellGroup.size() === 0)
      this.cellGroups.element = this.cellGroups.element.filter(group => group !== cellGroup)
        .map((group, index) => {
          group.id = index;
          return group;
        });
  }

  private _showMatrices() {
    const matrices = this._computeMatrices();
    if (matrices)
      this._matDialog.open(MatricesComponent, {
        data: [
          { name: 'L', entries: matrices.L.toArray() },
          { name: 'Dp', entries: matrices.Dp.toArray() },
          { name: 'R', entries: matrices.R.toArray() },
          { name: 'Dq', entries: matrices.Dq.toArray() },
          { name: 'T', entries: matrices.T.toArray() },
          { name: 'r', entries: matrices.r.toArray() }
        ],
        autoFocus: false
      });
  }

  private _computeMatrices() {
    try {
      const L = zeros(this.columns.property.length, this.columns.element.length) as Matrix;
      const R = zeros(this.columns.quality.length, this.columns.property.length) as Matrix;
      this._Dp = this._Dp.resize([this.columns.property.length, this.columns.element.length], 0);
      // Dq has size of RL
      this._Dq = this._Dq.resize([this.columns.quality.length, this.columns.element.length], 0);
      this.linkTable.forEach(links => {
        for (const link of links) {
          switch (link.source.column) {
            case 'element':
              L.set([link.target.id, link.source.id], 1);
              this._Dp.set([link.target.id, link.source.id], 0);
              break;
            case 'property':
              R.set([link.target.id, link.source.id], 1);
              this._Dq.set([link.target.id, link.source.id], 0);
              break;
          }
        }
      });
      const e = matrix(this.columns.element.map(cell => cell.isOn ? 1 : 0));
      // q = [ R (L – Dp) – Dq ] e
      const q = multiply(subtract(multiply(R, subtract(L, this._Dp)), this._Dq), e) as Matrix;
      // r = w / |w|
      const totalQualityWeight = sum(this.columns.quality.map(cell => cell.weight));
      const w = matrix(this.columns.quality.map(cell => cell.weight / totalQualityWeight));
      const r = divide(w, hypot(w as any)) as Matrix;

      // T = R (L - Dp) – Dq
      const T = subtract(multiply(R, subtract(L, this._Dp)), this._Dq) as Matrix;

      return { L, Dp: this._Dp, R, Dq: this._Dq, T, r, e, q };
    }
    catch (e) {
      console.warn(e.message);
      return null;
    }
  }

  private _computeAngle(q: Matrix, r: Matrix): string {
    // A(q,r) = <q,r> /(|q||r|)
    const angle = Math.acos(dot(q, r) / (hypot(q as any) * hypot(r as any))) * 180 / Math.PI;
    return angle ? angle.toFixed(2) + ' deg' : '';
  }

  private _computeStrength(q: Matrix, r: Matrix, e: Matrix): string {
    // S(q,r) = <q,r> / Transpose(e)e
    const strength = divide(dot(q, r), multiply(transpose(e), e)) as number;
    return strength ? strength.toFixed(2) : '';
  }

  private _turnCellsOnOrOff(onOrOff: boolean) {
    this.selectedCells.filter(selected => selected.column === 'element')
      .forEach(cell => cell.isOn = onOrOff);
    this._changeDetector.detectChanges();
  }

  private _exportGraphAsPng() {
    const graph = this._canvasContainer.cloneNode(true) as SVGElement;
    document.body.appendChild(graph);
    graph.querySelectorAll('.column-header__add-cell')
      .forEach(addButton => addButton.parentElement.removeChild(addButton));
    graph.querySelectorAll('*[data-selected]')
      .forEach(selected => selected.removeAttribute('data-selected'));
    svgAsPngUri(graph, {}, (uri: string) => {
      download(this._graphModel.attributes['Graph name'] || 'graph.png', uri);
      document.body.removeChild(graph);
    });
  }

  private _editDpMatrix() {
    this._Dp = this._Dp.resize([this.columns.property.length, this.columns.element.length], 0);
    this.linkTable.forEach(links => {
      for (const link of links)
        if (link.source.column === 'element')
          this._Dp.set([link.target.id, link.source.id], -1);
    });
    this._showMatrixEditor('Dp', this._Dp)
      .subscribe(resultingMatrix => {
        this._Dp = resultingMatrix;
        this._Dp.forEach((entry, index: any, matrix) => {
          if (entry === -1)
            matrix.set(index, 0);
        });
      });
  }

  private _editDqMatrix() {
    this._Dq = this._Dq.resize([this.columns.quality.length, this.columns.element.length], 0);
    this._showMatrixEditor('Dq', this._Dq)
      .subscribe(matrix => this._Dq = matrix);
  }

  private _showMatrixEditor(matrixName: string, matrix: Matrix): Observable<Matrix> {
    this._unselectAllSelectedComponents();
    this._changeDetector.detectChanges();
    return this._matDialog.open(MatrixEditorComponent, {
      data: { matrixName, matrix },
      disableClose: true,
      autoFocus: false
    }).afterClosed();
  }

  private _unselectAllSelectedComponents() {
    this.selectedCells = [];
    this.selectedLink = null;
  }

  private _saveGraphModel() {
    this._unselectAllSelectedComponents();
    const initialAttributes = [];
    if (!this._graphModel || !this._graphModel.attributes['Graph name'])
      initialAttributes.push(
        { name: 'Graph name', value: '' },
        { name: 'Date created', value: new DatePipe('en-US').transform(new Date(), 'MM/dd/yyyy, HH:mm:ss zzzz') }
      );
    else
      initialAttributes.push(
        ...Object.entries(this._graphModel.attributes)
          .map(([attrName, attrValue]) => ({ name: attrName, value: attrValue }))
          .sort((a, b) => {
            if (a.name === 'Graph name')
              return -1;
            if (b.name === 'Graph name')
              return 1;
            if (a.name === 'Date created')
              return -1;
            if (b.name === 'Date created')
              return 1;
            return -1;
          })
      );
    this._matDialog.open(AttributeEditorComponent, {
      data: initialAttributes,
      autoFocus: false
    })
      .afterClosed()
      .subscribe(attributes => {
        if (attributes.length > 0) {
          this._graphModel = this._constructGraphModel(true, attributes);
          const blob = new Blob([JSON.stringify(this._graphModel, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          download(`${this._graphModel.attributes['Graph name']}.json` || 'graph-model.json', url);
          URL.revokeObjectURL(url);
          this.modelChanged.emit(this._graphModel);
        }
      });
  }

  private _constructGraphModel(forStorage = false, attributes?: Attribute[]): GraphModel {
    const matrices = this._computeMatrices();
    if (matrices)
      return {
        ...Object.assign(
          forStorage
            ?
            {
              attributes: attributes.reduce((container, attr) => {
                container[attr.name] = attr.value;
                return container;
              }, {}),
              columns: Object.entries(this.columns)
                .reduce((container, [columnName, cells]) => {
                  container[columnName] = cells.map(this._constructCellGraphModel);
                  return container;
                }, { element: null, property: null, quality: null }),

              groups: Object.entries(this.cellGroups)
                .reduce((container, [columnName, groups]) => {
                  container[columnName] = groups.map(group => group.constructGroupGraphModel());
                  return container;
                }, { element: null, property: null, quality: null }),

              links: Array.from(this.linkTable.entries())
                .reduce((container, [source, links]) => {
                  container.push(this._constructLinkGraphModel(source, links));
                  return container;
                }, [])
            }
            :
            {
              attributes: (this._graphModel || { attributes: {} }).attributes,
              columns: null,
              groups: null,
              links: null
            }
        ),
        angle: this._computeAngle(matrices.q, matrices.r),
        strength: this._computeStrength(matrices.q, matrices.r, matrices.e),
        q: matrices.q.toArray() as number[]
      };
    return { attributes: {} } as GraphModel;
  }

  private _constructCellGraphModel(cell: Cell): CellGraphModel {
    return {
      id: cell.id,
      top: cell.top,
      left: cell.left,
      width: cell.width,
      height: cell.height,
      text: cell.text,
      column: cell.column,
      idSelector: cell.idSelector,
      cellGroup: cell.cellGroup.id,
      isOn: cell.isOn,
      weight: cell.weight
    };
  }

  private _constructLinkGraphModel(source: Cell, links: Link[]): LinkGraphModel {
    return {
      sourceColumn: source.column,
      sourceId: source.id,
      targets: links.map(link => {
        return {
          targetColumn: link.target.column,
          targetId: link.target.id,
          idSelector: link.idSelector,
          weight: link.weight
        };
      })
    };
  }

  private _importGraphModel(graphModel: GraphModel) {
    this._graphModel = graphModel;
    this._constructCellGroupsFromGraphModel(graphModel);
    this._constructColumnsFromGraphModel(graphModel);
    this._constructLinkTableFromGraphModel(graphModel);
    this._notifyChanges();
    this.modelChanged.emit(graphModel);
  }

  private _constructCellGroupsFromGraphModel(graphModel: GraphModel) {
    for (const [columnName, groups] of Object.entries(graphModel.groups)) {
      this.cellGroups[columnName] = groups.map(groupGraphModel => {
        const newCellGroup = new CellGroup(
          groupGraphModel.id,
          groupGraphModel.useDefaultSpacing,
          groupGraphModel.left,
          groupGraphModel.top,
          groupGraphModel.width,
          groupGraphModel.height
        );
        for (const cellGraphModel of groupGraphModel.cells) {
          const cell = graphModel.columns[cellGraphModel.column][cellGraphModel.id] as Cell;
          newCellGroup.addCell(cell);
        }
        return newCellGroup;
      });
    }
  }

  private _constructLinkTableFromGraphModel(graphModel: GraphModel) {
    this.linkTable.clear();
    for (const linkGraphModel of graphModel.links) {
      const source = graphModel.columns[linkGraphModel.sourceColumn][linkGraphModel.sourceId];
      for (const target of linkGraphModel.targets) {
        const targetCell = graphModel.columns[target.targetColumn][target.targetId];
        this._addNewLink(source as any, targetCell as any, target.weight);
      }
    }
  }

  private _constructColumnsFromGraphModel(graphModel: GraphModel) {
    for (const columnName in graphModel.columns)
      this.columns[columnName] = graphModel.columns[columnName];
  }

  private _onColumnLayoutChanged(layoutChange: ColumnLayoutChange) {
    switch (layoutChange.type) {
      case ColumnLayoutChangeType.CELL_ADDED:
      case ColumnLayoutChangeType.CELL_HEIGHT_INCREASED:
        const cells = this.columns[layoutChange.column];
        if (layoutChange.type === ColumnLayoutChangeType.CELL_ADDED) {
          this._expandCanvasIfCellOverflowsColumn(cells[cells.length - 1]);
        }
        this._notifyChanges(layoutChange.type === ColumnLayoutChangeType.CELL_HEIGHT_INCREASED ? layoutChange.column : null);
        break;
      case ColumnLayoutChangeType.CELL_HEIGHT_DECREASED:
        this._shrinkCanvasIfTooMuchEmptyVerticalSpace();
        this._notifyChanges(layoutChange.column);
        break;
    }
    this.selectedCells = this.selectedCells.filter(selected => selected !== layoutChange.trigger);
  }

  private _expandCanvasIfCellOverflowsColumn(cell: Cell) {
    const difference = (cell.top + cell.height) - this.columnHeight;
    if (difference > 0) {
      this._canvasContainer.style.height = this._canvasContainerRect.height
        + difference + 5
        + this._hostElement.nativeElement.scrollTop
        + 'px';
      this._canvasContainerRect = this._canvasContainer.getBoundingClientRect();
      this.columnHeight = this._canvasContainerRect.height - this.headerHeight;
    }
  }

  private _shrinkCanvasIfTooMuchEmptyVerticalSpace() {
    const largestMinimumColumnHeight = Object.values(this.columns)
      .map(cells => this._calculateMinimumColumnHeight(cells))
      .reduce((largest, columnMinimumHeight) => Math.max(largest, columnMinimumHeight), 0);

    const emptyVerticalSpace = this.columnHeight - largestMinimumColumnHeight;
    // 10 is the padding between the last cell and the canvas bottom border
    if (emptyVerticalSpace > 10) {
      const adjustedHeight = Math.max(this.columnHeight - (emptyVerticalSpace - 10), this._canvasInitialHeight);
      this._canvasContainer.style.height = (adjustedHeight + this.headerHeight) + 'px';
      this.columnHeight = adjustedHeight;
      this._canvasContainerRect = this._canvasContainer.getBoundingClientRect();
    }
  }

  private _calculateMinimumColumnHeight(cells: Cell[]) {
    const minimumSpacingBetweenCells = 5;
    return this._sumCellHeights(cells) + minimumSpacingBetweenCells * (cells.length + 1);
  }

  private _sumCellHeights(cells: Cell[]) {
    return cells.reduce((sum, cell) => sum + cell.height, 0);
  }

  @HostListener('window:keydown', ['$event'])
  onKeyPressed(event: KeyboardEvent) {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (this.selectedCells.length > 0) {
        this._deleteSelectedCells();
        this._ungroupSelectedCells(false);
        this.selectedCells = [];
        this._commandService.select(CommandAction.ACTIVATE_CELL_GROUPING);
        this.modelChanged.emit(this._constructGraphModel());
        setTimeout(() => {
          this._notifyChanges(null);
          this._shrinkCanvasIfTooMuchEmptyVerticalSpace();
        });
      }
      else if (this.selectedLink) {
        this._enableEntryRepresentingLinkInMatrixDp(this.selectedLink);
        this._deleteLink(this.selectedLink);
        this._notifyChanges(null);
        this.modelChanged.emit(this._constructGraphModel());
      }
    }
  }

  private _deleteSelectedCells() {
    for (const cellToDelete of this.selectedCells) {
      this.columns[cellToDelete.column] = this.columns[cellToDelete.column].filter(cell => cell !== cellToDelete);
      this.linkTable.delete(cellToDelete);
      this.linkTable.forEach(links => {
        for (const link of links)
          if (link.target === cellToDelete) {
            this._deleteLink(link);
            if (link.source.column === 'element')
              this._enableEntryRepresentingLinkInMatrixDp(link);
          }
      });
    }
    this._adjustCellIds(new Set<ColumnId>(this.selectedCells.map(cell => cell.column)));
    this._adjustLinkSelectorsInLinkTable();
  }

  private _adjustCellIds(affectedColumns: Set<ColumnId>) {
    for (const affectedColumn of affectedColumns) {
      const cells = this.columns[affectedColumn];
      for (let index = 0; index < cells.length; index++) {
        const cell = cells[index];
        cell.id = index;
        cell.idSelector = `${cell.column}-cell-${index}`;
      }
    }
  }

  private _adjustLinkSelectorsInLinkTable() {
    this.linkTable.forEach(links => {
      for (const link of links)
        link.idSelector = link.source.idSelector + '_' + link.target.idSelector;
    });
  }

  private _deleteLink(link: Link) {
    const updatedLinks = this.linkTable.get(link.source)
      .filter(e => e !== link);
    if (updatedLinks.length === 0)
      this.linkTable.delete(link.source);
    else
      this.linkTable.set(link.source, updatedLinks);
    this.selectedLink = null;
  }

  private _enableEntryRepresentingLinkInMatrixDp(deletedLink: Link) {
    this._Dp.set([deletedLink.target.id, deletedLink.source.id], 0);
  }

  private _notifyChanges(column?: ColumnId) {
    this.linkTable = new Map<Cell, Link[]>(this.linkTable);
    if (column)
      this.cellGroups[column] = this.cellGroups[column].map(group => group.clone());
    this._changeDetector.detectChanges();
  }

  onLinkSelected(link: Link) {
    this.selectedCells = [];
    this.selectedLink = link;
    this._commandService.select(CommandAction.ACTIVATE_SHOW_ASSOCIATIONS);
  }

  onCellAdded(columnId: ColumnId) {
    const newCell = this._createNewCell(columnId);
    this.columns[columnId] = this.columns[columnId].concat(newCell);
    this._addToDefaultCellGroup(newCell);
    this.modelChanged.emit(this._constructGraphModel());
    // Wait until the new cell was rendered, then start editing the label by dispatching double left click event
    setTimeout(() => {
      this._notifyChanges(columnId);
      newCell.domInstance.querySelector('rect')
        .dispatchEvent(new CustomEvent('dblclick'));
    }, 0);
  }

  private _addToDefaultCellGroup(cell: Cell) {
    const defaultCellGroup = this.cellGroups[cell.column].pop();
    defaultCellGroup.addCell(cell);
    this.cellGroups[cell.column].push(defaultCellGroup);
    // this._changeDetector.detectChanges();
  }

  private _createNewCell(columnId: ColumnId): Cell {
    const id = this.columns[columnId].length
    return {
      id,
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      text: 'Double click to add text',
      column: columnId,
      idSelector: `${columnId}-cell-${id}`,
      domInstance: null,
      cellGroup: null,
      isOn: true,
      weight: 0
    }
  }

  onElementCellClicked(selectionEvent: CellSelectionEvent) {
    this._addToOrRemoveFromSelectedCells(selectionEvent);
    this._activateCellGroupingOrCellUngroupingCommand();
    this._activateTurnOnCellOrTurnOffCellCommand();
    this.selectedLink = null;
  }

  onPropertyCellClicked(selectionEvent: CellSelectionEvent) {
    // Only "element" column can add links to "element" column
    this._addLinksOrAddToOrRemoveFromSelectedCells('element', selectionEvent);
    this._activateCellGroupingOrCellUngroupingCommand();
  }

  onQualityCellClicked(selectionEvent: CellSelectionEvent) {
    // Only "property" column can add links to "property" column
    this._addLinksOrAddToOrRemoveFromSelectedCells('property', selectionEvent);
    this._activateCellGroupingOrCellUngroupingCommand();
  }

  private _activateCellGroupingOrCellUngroupingCommand() {
    if (this.selectedCells.length > 0) {
      if (this.selectedCells.some(cell => !cell.cellGroup.useDefaultSpacing))
        this._commandService.select(CommandAction.ACTIVATE_CELL_GROUPING);
      else
        this._commandService.select(CommandAction.ACTIVATE_CELL_UNGROUPING);
    }
    else
      this._commandService.select(CommandAction.ACTIVATE_CELL_GROUPING);
  }

  private _activateTurnOnCellOrTurnOffCellCommand() {
    if (this.selectedCells.some(selected => !selected.isOn))
      this._commandService.select(CommandAction.ACTIVATE_TURN_ON_CELL);
    else
      this._commandService.select(CommandAction.ACTIVATE_TURN_OFF_CELL);
  }

  private _addLinksOrAddToOrRemoveFromSelectedCells(sourceColumn: 'element' | 'property', event: CellSelectionEvent) {
    switch (event.type) {
      case CellSelectionEventType.NEW_SELECTION:
        if (this.selectedCells.length > 0) {
          const addedLinks = this.selectedCells.map(e => e.column === sourceColumn && this._addNewLink(e, event.cell))
            .filter(added => added);
          if (addedLinks.length > 0) {
            this._notifyChanges(null);
            this.modelChanged.emit(this._constructGraphModel());
          }
          else
            this._addToOrRemoveFromSelectedCells(event);
        }
        else
          this._addToOrRemoveFromSelectedCells(event);
        break;
      default:
        this._addToOrRemoveFromSelectedCells(event);
        break;
    }
    this.selectedLink = null;
  }

  private _addToOrRemoveFromSelectedCells(selectionEvent: CellSelectionEvent) {
    switch (selectionEvent.type) {
      case CellSelectionEventType.UNSELECT:
        this.selectedCells = this.selectedCells.filter(selectedCell => selectedCell !== selectionEvent.cell);
        break;
      case CellSelectionEventType.NEW_SELECTION:
        this.selectedCells = [selectionEvent.cell];
        break;
      case CellSelectionEventType.SELECT:
        this.selectedCells = this.selectedCells.concat(selectionEvent.cell);
        break;
    }
  }

  private _addNewLink(source: Cell, target: Cell, weight?: number) {
    const newLink = {
      source,
      target,
      idSelector: source.idSelector + '_' + target.idSelector,
      weight: weight || 1.0,
      domInstance: null
    };

    if (!this.linkTable.has(source)) {
      this.linkTable.set(source, [newLink]);
      return true;
    }
    else if (!this._linkExists(this.linkTable.get(source), newLink)) {
      this.linkTable.get(source)
        .push(newLink);
      return true;
    }
    return false;
  }

  private _linkExists(links: Link[], newLink: Link) {
    return links.some(e => e.source === newLink.source && e.target === newLink.target);
  }

}