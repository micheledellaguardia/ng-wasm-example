import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WasmExample } from './wasm-example';

describe('WasmExample', () => {
  let component: WasmExample;
  let fixture: ComponentFixture<WasmExample>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WasmExample]
    })
      .compileComponents();

    fixture = TestBed.createComponent(WasmExample);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
