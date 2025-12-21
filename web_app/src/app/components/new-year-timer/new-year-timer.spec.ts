import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NewYearTimer } from './new-year-timer';

describe('NewYearTimer', () => {
  let component: NewYearTimer;
  let fixture: ComponentFixture<NewYearTimer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewYearTimer]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NewYearTimer);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
