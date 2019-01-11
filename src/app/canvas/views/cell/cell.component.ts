import { Component, Input, ElementRef, ViewChild, AfterViewInit, HostListener } from '@angular/core';

import { Cell } from '../../models/Cell';
import { TextEditorService } from '../text-editor/text-editor.service';
import { ColumnLayoutChangeService } from '../../services/column-layout-change.service';
import { ColumnLayoutChangeType } from '../../models/ColumnLayoutChange';

@Component({
  selector: 'g[cell]',
  templateUrl: './cell.component.html',
  styleUrls: ['./cell.component.scss']
})
export class CellComponent implements AfterViewInit {

  @Input()
  cell: Cell;

  @ViewChild('cellElement')
  private _cellElementRef: ElementRef<SVGGElement>;

  constructor(
    private _textEditorService: TextEditorService,
    private _columnLayoutChange: ColumnLayoutChangeService) {

  }

  ngAfterViewInit() {
    this.cell.domInstance = this._cellElementRef.nativeElement;
    (this._cellElementRef.nativeElement as any).__cell__ = this.cell;
  }

  @HostListener('dblclick', ['$event.target.parentElement', '$event'])
  showTextEditor(target: HTMLElement | SVGGElement, event: MouseEvent) {
    event.stopPropagation();
    if (target.hasAttribute('data-cell')) {
      event.stopPropagation();
      this._textEditorService.show(this.cell)
        .textAdded((payload, cellBeingEdited) =>
          this._onTextAdded(payload, cellBeingEdited));
    }
  }

  private _onTextAdded(payload: { text: string, textContainerHeight: number }, cellBeingEdited: Cell) {
    this._addTextToCellBeingEdited(payload.text, cellBeingEdited);
    const heightDifference = payload.textContainerHeight - cellBeingEdited.height;
    if (heightDifference !== 0) {
      cellBeingEdited.height = Math.max(payload.textContainerHeight + 10, 50); // 10 = padding top and bottom
      this._columnLayoutChange.notify(
        cellBeingEdited.column,
        heightDifference < 0 ? ColumnLayoutChangeType.CELL_HEIGHT_DECREASED : ColumnLayoutChangeType.CELL_HEIGHT_INCREASED,
        cellBeingEdited
      );
    }
    cellBeingEdited.text = payload.text;
    cellBeingEdited.domInstance.removeAttribute('data-selected');
  }

  private _addTextToCellBeingEdited(text: string, cellBeingEdited: Cell) {
    const foreignObject = cellBeingEdited.domInstance.querySelector('foreignObject');
    foreignObject.setAttribute('x', '0');
    foreignObject.setAttribute('y', '0');
    foreignObject.setAttribute('width', String(cellBeingEdited.width));
    foreignObject.setAttribute('height', String(cellBeingEdited.height));
    foreignObject.firstElementChild.textContent = text;
  }

}